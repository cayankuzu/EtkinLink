begin;

alter table public.push_tokens
  add column if not exists installation_id uuid,
  add column if not exists app_environment text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists revocation_reason text;

update public.push_tokens
set installation_id = coalesce(installation_id, gen_random_uuid()),
    app_environment = coalesce(app_environment, 'production'),
    token_expires_at = coalesce(
      token_expires_at,
      greatest(last_seen_at, clock_timestamp()) + interval '14 days'
    )
where installation_id is null
   or app_environment is null
   or token_expires_at is null;

alter table public.push_tokens
  add constraint push_tokens_installation_id_nn
    check (installation_id is not null) not valid,
  add constraint push_tokens_app_environment_nn
    check (app_environment is not null) not valid,
  add constraint push_tokens_token_expires_at_nn
    check (token_expires_at is not null) not valid,
  add constraint push_tokens_app_environment_check
    check (app_environment in ('development', 'preview', 'production'))
    not valid,
  add constraint push_tokens_revocation_reason_check
    check (
      revocation_reason is null
      or revocation_reason in (
        'logout',
        'session_loss',
        'account_switch',
        'permission_denied',
        'token_rotation',
        'provider_invalid',
        'legacy_unregister'
      )
    ) not valid;

alter table public.push_tokens
  validate constraint push_tokens_installation_id_nn;
alter table public.push_tokens
  validate constraint push_tokens_app_environment_nn;
alter table public.push_tokens
  validate constraint push_tokens_token_expires_at_nn;
alter table public.push_tokens
  validate constraint push_tokens_app_environment_check;
alter table public.push_tokens
  validate constraint push_tokens_revocation_reason_check;

alter table public.push_tokens
  alter column installation_id set not null,
  alter column installation_id set default gen_random_uuid(),
  alter column app_environment set not null,
  alter column app_environment set default 'production',
  alter column token_expires_at set not null,
  alter column token_expires_at set default (now() + interval '14 days');

alter table public.push_tokens
  drop constraint push_tokens_installation_id_nn,
  drop constraint push_tokens_app_environment_nn,
  drop constraint push_tokens_token_expires_at_nn;

create unique index push_tokens_active_installation_uidx
  on public.push_tokens (
    user_id,
    installation_id,
    project_id,
    app_environment
  )
  where disabled_at is null;

create index push_tokens_active_delivery_idx
  on public.push_tokens (user_id, token_expires_at desc, last_seen_at desc)
  where disabled_at is null;

create or replace function public.sync_push_installation(
  expo_token text,
  token_platform text,
  project_id uuid,
  client_installation_id uuid,
  app_environment text,
  app_version text default null,
  previous_expo_tokens text[] default '{}'::text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_previous_tokens text[] := coalesce(previous_expo_tokens, '{}'::text[]);
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if client_installation_id is null or project_id is null then
    raise exception using errcode = '22023', message = 'Geçersiz push kurulum bağı.';
  end if;
  if token_platform not in ('android', 'ios') then
    raise exception using errcode = '22023', message = 'Geçersiz bildirim platformu.';
  end if;
  if app_environment not in ('development', 'preview', 'production') then
    raise exception using errcode = '22023', message = 'Geçersiz uygulama ortamı.';
  end if;
  if expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception using errcode = '22023', message = 'Geçersiz Expo push token.';
  end if;
  if cardinality(safe_previous_tokens) > 2
    or exists (
      select 1
      from unnest(safe_previous_tokens) as previous_token(value)
      where previous_token.value is null
        or previous_token.value !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
    ) then
    raise exception using errcode = '22023', message = 'Geçersiz önceki push token listesi.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      client_installation_id::text || ':' || project_id::text || ':' || app_environment,
      0
    )
  );

  insert into public.notification_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  -- A secure recovery record can carry at most the current and immediately
  -- previous OS token. Exact token possession prevents installation-ID-only
  -- cross-account revocation.
  update public.push_tokens as token
  set disabled_at = coalesce(token.disabled_at, clock_timestamp()),
      token_expires_at = least(token.token_expires_at, clock_timestamp()),
      revocation_reason = case
        when token.user_id = current_user_id then 'token_rotation'
        else 'account_switch'
      end,
      updated_at = clock_timestamp()
  where token.disabled_at is null
    and token.installation_id = client_installation_id
    and token.expo_push_token = any(safe_previous_tokens)
    and token.expo_push_token <> expo_token;

  update public.push_tokens as token
  set disabled_at = coalesce(token.disabled_at, clock_timestamp()),
      token_expires_at = least(token.token_expires_at, clock_timestamp()),
      revocation_reason = 'token_rotation',
      updated_at = clock_timestamp()
  where token.user_id = current_user_id
    and token.installation_id = client_installation_id
    and token.project_id = sync_push_installation.project_id
    and token.app_environment = sync_push_installation.app_environment
    and token.expo_push_token <> expo_token
    and token.disabled_at is null;

  insert into public.push_tokens (
    user_id,
    expo_push_token,
    platform,
    project_id,
    installation_id,
    app_environment,
    app_version,
    last_seen_at,
    token_expires_at,
    disabled_at,
    revocation_reason
  )
  values (
    current_user_id,
    expo_token,
    token_platform,
    project_id,
    client_installation_id,
    app_environment,
    nullif(btrim(app_version), ''),
    clock_timestamp(),
    clock_timestamp() + interval '14 days',
    null,
    null
  )
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    project_id = excluded.project_id,
    installation_id = excluded.installation_id,
    app_environment = excluded.app_environment,
    app_version = excluded.app_version,
    last_seen_at = excluded.last_seen_at,
    token_expires_at = excluded.token_expires_at,
    disabled_at = null,
    revocation_reason = null,
    updated_at = clock_timestamp();
end;
$$;

create or replace function public.revoke_push_installation(
  client_installation_id uuid,
  app_environment text,
  expo_token text default null,
  revocation_reason text default 'logout'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  affected_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if client_installation_id is null
    or app_environment not in ('development', 'preview', 'production')
    or revocation_reason not in (
      'logout',
      'session_loss',
      'account_switch',
      'permission_denied'
    )
    or (
      expo_token is not null
      and expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$'
    ) then
    raise exception using errcode = '22023', message = 'Geçersiz push iptal isteği.';
  end if;

  update public.push_tokens as token
  set disabled_at = coalesce(token.disabled_at, clock_timestamp()),
      token_expires_at = least(token.token_expires_at, clock_timestamp()),
      revocation_reason = revoke_push_installation.revocation_reason,
      updated_at = clock_timestamp()
  where token.user_id = current_user_id
    and token.installation_id = client_installation_id
    and token.app_environment = revoke_push_installation.app_environment
    and (
      revoke_push_installation.expo_token is null
      or token.expo_push_token = revoke_push_installation.expo_token
    )
    and token.disabled_at is null;

  get diagnostics affected_count = row_count;
  return affected_count > 0;
end;
$$;

create or replace function public.claim_notification_event(target_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.notification_events;
  token_payload jsonb;
begin
  select event.* into target_event
  from public.notification_events as event
  where event.id = target_event_id
    and (
      (
        event.delivery_status in ('pending', 'failed')
        and event.next_attempt_at <= now()
      )
      or (
        event.delivery_status = 'processing'
        and event.processing_started_at < now() - interval '10 minutes'
      )
    )
    and event.attempt_count < 5
  for update skip locked;

  if not found then return null; end if;

  update public.notification_events
  set delivery_status = 'processing',
      processing_started_at = now(),
      attempt_count = attempt_count + 1,
      last_error_code = null
  where id = target_event.id
  returning * into target_event;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', token.id,
        'token', token.expo_push_token,
        'platform', token.platform
      )
      order by token.last_seen_at desc
    ),
    '[]'::jsonb
  ) into token_payload
  from public.push_tokens as token
  where token.user_id = target_event.user_id
    and token.disabled_at is null
    and token.token_expires_at > clock_timestamp();

  if jsonb_array_length(token_payload) = 0 then
    update public.notification_events
    set delivery_status = 'cancelled',
        processing_started_at = null,
        last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
    where id = target_event.id;
  end if;

  return jsonb_build_object('event', to_jsonb(target_event), 'tokens', token_payload);
end;
$$;

create or replace function public.claim_notification_events(
  requested_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(requested_batch_size, 20), 1), 25);
  target_event public.notification_events;
  token_payload jsonb;
  result_payload jsonb := '[]'::jsonb;
begin
  update public.notification_events
  set delivery_status = 'cancelled',
      processing_started_at = null,
      last_error_code = 'MAX_ATTEMPTS_EXHAUSTED'
  where delivery_status in ('pending', 'failed', 'processing')
    and attempt_count >= 5;

  for target_event in
    select event.*
    from public.notification_events as event
    where (
      (
        event.delivery_status in ('pending', 'failed')
        and event.next_attempt_at <= now()
      )
      or (
        event.delivery_status = 'processing'
        and event.processing_started_at < now() - interval '10 minutes'
      )
    )
      and event.attempt_count < 5
    order by event.created_at, event.id
    limit safe_batch_size
    for update skip locked
  loop
    update public.notification_events
    set delivery_status = 'processing',
        processing_started_at = now(),
        attempt_count = attempt_count + 1,
        last_error_code = null
    where id = target_event.id
    returning * into target_event;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', token.id,
          'token', token.expo_push_token,
          'platform', token.platform
        )
        order by token.last_seen_at desc
      ),
      '[]'::jsonb
    ) into token_payload
    from public.push_tokens as token
    where token.user_id = target_event.user_id
      and token.disabled_at is null
      and token.token_expires_at > clock_timestamp();

    if jsonb_array_length(token_payload) = 0 then
      update public.notification_events
      set delivery_status = 'cancelled',
          processing_started_at = null,
          last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
      where id = target_event.id;
    else
      result_payload := result_payload || jsonb_build_array(
        jsonb_build_object('event', to_jsonb(target_event), 'tokens', token_payload)
      );
    end if;
  end loop;

  return result_payload;
end;
$$;

revoke all on function public.sync_push_installation(
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text[]
) from public, anon, authenticated;
grant execute on function public.sync_push_installation(
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text[]
) to authenticated;

revoke all on function public.revoke_push_installation(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_push_installation(uuid, text, text, text)
  to authenticated;

revoke all on function public.claim_notification_event(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_notification_event(uuid) to service_role;

revoke all on function public.claim_notification_events(integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_events(integer) to service_role;

comment on function public.sync_push_installation(text, text, uuid, uuid, text, text, text[]) is
  'Atomically binds one Expo token to an authenticated user, persistent installation, platform, project, and environment with a fourteen-day renewable lease and bounded rotation recovery.';
comment on function public.revoke_push_installation(uuid, text, text, text) is
  'Creates an owner-scoped push installation tombstone for logout, session loss, account switch, or permission removal.';
comment on column public.push_tokens.installation_id is
  'Opaque, device-local UUID stored in this-device-only secure storage; never grants access by itself.';
comment on column public.push_tokens.token_expires_at is
  'Renewable server-side safety lease bounding delivery after offline logout or unrecoverable session loss.';

commit;

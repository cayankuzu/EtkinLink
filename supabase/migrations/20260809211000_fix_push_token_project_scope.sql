begin;

create or replace function public.register_push_token(
  expo_token text,
  token_platform text,
  project_id uuid,
  app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if register_push_token.token_platform not in ('android', 'ios') then
    raise exception using errcode = '22023', message = 'Geçersiz bildirim platformu.';
  end if;
  if register_push_token.expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
    raise exception using errcode = '22023', message = 'Geçersiz Expo push token.';
  end if;

  insert into public.notification_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  insert into public.push_tokens (
    user_id,
    expo_push_token,
    platform,
    project_id,
    app_version,
    last_seen_at,
    disabled_at
  )
  values (
    current_user_id,
    register_push_token.expo_token,
    register_push_token.token_platform,
    register_push_token.project_id,
    nullif(btrim(register_push_token.app_version), ''),
    now(),
    null
  )
  on conflict (expo_push_token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    project_id = excluded.project_id,
    app_version = excluded.app_version,
    last_seen_at = now(),
    disabled_at = null,
    updated_at = now();

  update public.push_tokens as token
  set disabled_at = coalesce(token.disabled_at, now()),
      updated_at = now()
  where token.user_id = current_user_id
    and token.project_id <> register_push_token.project_id
    and token.disabled_at is null;
end;
$$;

revoke all on function public.register_push_token(text, text, uuid, text) from public;
grant execute on function public.register_push_token(text, text, uuid, text) to authenticated;

commit;

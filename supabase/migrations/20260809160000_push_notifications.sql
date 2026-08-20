begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  direct_messages_enabled boolean not null default true,
  room_messages_enabled boolean not null default true,
  likes_enabled boolean not null default true,
  matches_enabled boolean not null default true,
  event_reminders_enabled boolean not null default true,
  system_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  project_id uuid not null,
  app_version text,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_platform check (platform in ('android', 'ios')),
  constraint push_tokens_token_length check (char_length(expo_push_token) between 20 and 512),
  constraint push_tokens_app_version_length check (app_version is null or char_length(app_version) between 1 and 40)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  route_kind text,
  route_id uuid,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  channel_id text not null default 'system',
  dedupe_key text not null unique,
  delivery_status text not null default 'pending',
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_events_kind check (
    kind in ('new_like', 'new_match', 'direct_message', 'room_message', 'match_ended', 'event_reminder', 'system')
  ),
  constraint notification_events_route check (
    route_kind is null or route_kind in ('match', 'room', 'likes', 'event')
  ),
  constraint notification_events_channel check (
    channel_id in ('messages', 'rooms', 'matches', 'events', 'system')
  ),
  constraint notification_events_status check (
    delivery_status in ('pending', 'processing', 'sent', 'failed', 'cancelled')
  ),
  constraint notification_events_title_length check (char_length(title) between 1 and 100),
  constraint notification_events_body_length check (char_length(body) between 1 and 240),
  constraint notification_events_dedupe_length check (char_length(dedupe_key) between 8 and 240),
  constraint notification_events_attempts check (attempt_count between 0 and 10)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  push_token_id uuid not null references public.push_tokens(id) on delete cascade,
  status text not null,
  expo_ticket_id text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_event_id, push_token_id),
  constraint notification_deliveries_status check (status in ('sent', 'failed')),
  constraint notification_deliveries_error_length check (error_message is null or char_length(error_message) <= 500)
);

create index push_tokens_user_active_idx
  on public.push_tokens (user_id, last_seen_at desc)
  where disabled_at is null;
create index notification_events_user_idx
  on public.notification_events (user_id, created_at desc);
create index notification_events_outbox_idx
  on public.notification_events (delivery_status, next_attempt_at, created_at)
  where delivery_status in ('pending', 'failed');
create index notification_deliveries_event_idx
  on public.notification_deliveries (notification_event_id, created_at);

insert into public.notification_preferences (user_id)
select profile.id
from public.profiles as profile
on conflict (user_id) do nothing;

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function private.set_updated_at();

create trigger push_tokens_set_updated_at
before update on public.push_tokens
for each row execute function private.set_updated_at();

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function private.set_updated_at();

create or replace function private.create_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger profiles_create_notification_preferences
after insert on public.profiles
for each row execute function private.create_notification_preferences();

create or replace function private.notification_kind_enabled(
  target_user_id uuid,
  target_kind text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when target_kind = 'direct_message' then preference.direct_messages_enabled
        when target_kind = 'room_message' then preference.room_messages_enabled
        when target_kind = 'new_like' then preference.likes_enabled
        when target_kind in ('new_match', 'match_ended') then preference.matches_enabled
        when target_kind = 'event_reminder' then preference.event_reminders_enabled
        else preference.system_enabled
      end
      from public.notification_preferences as preference
      where preference.user_id = target_user_id
    ),
    true
  );
$$;

create or replace function private.enqueue_notification(
  target_user_id uuid,
  target_actor_user_id uuid,
  target_kind text,
  target_route_kind text,
  target_route_id uuid,
  target_title text,
  target_body text,
  target_payload jsonb,
  target_channel_id text,
  target_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if target_user_id is null or target_user_id = target_actor_user_id then
    return null;
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = target_user_id
      and profile.account_disabled_at is null
  ) then
    return null;
  end if;
  if not private.notification_kind_enabled(target_user_id, target_kind) then
    return null;
  end if;

  insert into public.notification_events (
    user_id,
    actor_user_id,
    kind,
    route_kind,
    route_id,
    title,
    body,
    payload,
    channel_id,
    dedupe_key
  )
  values (
    target_user_id,
    target_actor_user_id,
    target_kind,
    target_route_kind,
    target_route_id,
    left(target_title, 100),
    left(target_body, 240),
    coalesce(target_payload, '{}'::jsonb),
    target_channel_id,
    target_dedupe_key
  )
  on conflict (dedupe_key) do nothing
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function private.profile_notification_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(btrim(profile.full_name), ''), nullif(profile.username::text, ''), 'Bir kullanıcı')
  from public.profiles as profile
  where profile.id = target_user_id;
$$;

create or replace function private.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
begin
  sender_name := coalesce(private.profile_notification_name(new.sender_id), 'Bir kullanıcı');
  perform private.enqueue_notification(
    new.receiver_id,
    new.sender_id,
    'direct_message',
    'match',
    new.match_id,
    sender_name,
    left(new.body, 180),
    jsonb_build_object('matchId', new.match_id, 'messageId', new.id),
    'messages',
    'direct-message:' || new.id::text
  );
  return new;
end;
$$;

create trigger direct_messages_enqueue_push
after insert on public.direct_messages
for each row execute function private.notify_direct_message();

create or replace function private.notify_room_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  attendee record;
  sender_name text;
  event_title text;
begin
  sender_name := coalesce(private.profile_notification_name(new.sender_id), 'Bir kullanıcı');
  select event.title into event_title
  from public.events as event
  where event.id = new.event_id;

  for attendee in
    select participant.user_id
    from public.event_attendees as participant
    where participant.event_id = new.event_id
      and participant.status = 'joined'
      and participant.user_id <> new.sender_id
      and not private.is_blocked(participant.user_id, new.sender_id)
  loop
    perform private.enqueue_notification(
      attendee.user_id,
      new.sender_id,
      'room_message',
      'room',
      new.event_id,
      coalesce(event_title, 'Etkinlik odası'),
      left(sender_name || ': ' || new.body, 180),
      jsonb_build_object('eventId', new.event_id, 'messageId', new.id),
      'rooms',
      'room-message:' || new.id::text || ':' || attendee.user_id::text
    );
  end loop;
  return new;
end;
$$;

create trigger room_messages_enqueue_push
after insert on public.room_messages
for each row execute function private.notify_room_message();

create or replace function private.notify_new_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  liker_name text;
begin
  if private.is_blocked(new.user_id, new.liked_user_id) then
    return new;
  end if;
  if exists (
    select 1
    from public.matches as match
    where match.user1_id = least(new.user_id, new.liked_user_id)
      and match.user2_id = greatest(new.user_id, new.liked_user_id)
      and match.status = 'active'
  ) then
    return new;
  end if;

  liker_name := coalesce(private.profile_notification_name(new.user_id), 'Bir kullanıcı');
  perform private.enqueue_notification(
    new.liked_user_id,
    new.user_id,
    'new_like',
    'likes',
    new.event_id,
    'Yeni bir beğeni aldın',
    liker_name || ' seni bir etkinlik üzerinden beğendi.',
    jsonb_build_object('eventId', new.event_id, 'userId', new.user_id),
    'matches',
    'new-like:' || new.event_id::text || ':' || new.user_id::text || ':' || new.liked_user_id::text
  );
  return new;
end;
$$;

create constraint trigger event_likes_enqueue_push
after insert on public.event_likes
deferrable initially deferred
for each row execute function private.notify_new_like();

create or replace function private.notify_match_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user1_name text;
  user2_name text;
  recipient_id uuid;
  actor_id uuid;
  became_active boolean := false;
begin
  if tg_op = 'INSERT' then
    became_active := new.status = 'active';
  else
    became_active := new.status = 'active' and old.status is distinct from 'active';
  end if;

  if became_active then
    user1_name := coalesce(private.profile_notification_name(new.user1_id), 'Bir kullanıcı');
    user2_name := coalesce(private.profile_notification_name(new.user2_id), 'Bir kullanıcı');

    perform private.enqueue_notification(
      new.user1_id,
      new.user2_id,
      'new_match',
      'match',
      new.id,
      'Eşleştiniz!',
      user2_name || ' ile karşılıklı olarak birbirinizi beğendiniz.',
      jsonb_build_object('matchId', new.id, 'eventId', new.event_id),
      'matches',
      'new-match:' || new.id::text || ':' || new.updated_at::text || ':' || new.user1_id::text
    );
    perform private.enqueue_notification(
      new.user2_id,
      new.user1_id,
      'new_match',
      'match',
      new.id,
      'Eşleştiniz!',
      user1_name || ' ile karşılıklı olarak birbirinizi beğendiniz.',
      jsonb_build_object('matchId', new.id, 'eventId', new.event_id),
      'matches',
      'new-match:' || new.id::text || ':' || new.updated_at::text || ':' || new.user2_id::text
    );
  elsif tg_op = 'UPDATE'
    and new.status = 'ended'
    and old.status is distinct from 'ended' then
    actor_id := new.ended_by_user_id;
    if actor_id = new.user1_id then
      recipient_id := new.user2_id;
    elsif actor_id = new.user2_id then
      recipient_id := new.user1_id;
    else
      recipient_id := null;
    end if;
    if recipient_id is not null then
      perform private.enqueue_notification(
        recipient_id,
        actor_id,
        'match_ended',
        'match',
        new.id,
        'Eşleşme sona erdi',
        'Bu eşleşmede artık yeni mesaj gönderilemez.',
        jsonb_build_object('matchId', new.id, 'eventId', new.event_id),
        'matches',
        'match-ended:' || new.id::text || ':' || coalesce(new.ended_at, new.updated_at)::text
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger matches_enqueue_push
after insert or update of status on public.matches
for each row execute function private.notify_match_change();

create or replace function private.enqueue_due_event_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  queued_count integer := 0;
  queued_id uuid;
begin
  for candidate in
    select attendee.user_id, event.id as event_id, event.title, event.start_at
    from public.event_attendees as attendee
    join public.events as event on event.id = attendee.event_id
    where attendee.status = 'joined'
      and not event.is_cancelled
      and event.start_at > now() + interval '105 minutes'
      and event.start_at <= now() + interval '120 minutes'
  loop
    queued_id := private.enqueue_notification(
      candidate.user_id,
      null,
      'event_reminder',
      'event',
      candidate.event_id,
      'Etkinlik yaklaşıyor',
      left(candidate.title || ' yaklaşık 2 saat sonra başlıyor.', 240),
      jsonb_build_object('eventId', candidate.event_id, 'startAt', candidate.start_at),
      'events',
      'event-reminder-2h:' || candidate.event_id::text || ':' || candidate.user_id::text
    );
    if queued_id is not null then queued_count := queued_count + 1; end if;
  end loop;
  return queued_count;
end;
$$;

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
  if token_platform not in ('android', 'ios') then
    raise exception using errcode = '22023', message = 'Geçersiz bildirim platformu.';
  end if;
  if expo_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then
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
    expo_token,
    token_platform,
    project_id,
    nullif(btrim(app_version), ''),
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

  update public.push_tokens
  set disabled_at = coalesce(disabled_at, now()), updated_at = now()
  where user_id = current_user_id
    and project_id <> register_push_token.project_id
    and disabled_at is null;
end;
$$;

create or replace function public.unregister_push_token(expo_token text)
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
  update public.push_tokens
  set disabled_at = coalesce(disabled_at, now()), updated_at = now()
  where user_id = current_user_id
    and expo_push_token = unregister_push_token.expo_token;
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
    and event.delivery_status in ('pending', 'failed')
    and event.next_attempt_at <= now()
    and event.attempt_count < 5
  for update skip locked;

  if not found then return null; end if;

  update public.notification_events
  set delivery_status = 'processing',
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
    and token.last_seen_at > now() - interval '120 days';

  if jsonb_array_length(token_payload) = 0 then
    update public.notification_events
    set delivery_status = 'cancelled', last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
    where id = target_event.id;
  end if;

  return jsonb_build_object('event', to_jsonb(target_event), 'tokens', token_payload);
end;
$$;

alter table public.notification_preferences enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;

create policy notification_preferences_owner_read
on public.notification_preferences for select to authenticated
using (user_id = auth.uid());

create policy notification_events_owner_read
on public.notification_events for select to authenticated
using (user_id = auth.uid());

create policy notification_events_owner_mark_read
on public.notification_events for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke all on table public.notification_preferences from public, anon, authenticated;
revoke all on table public.push_tokens from public, anon, authenticated;
revoke all on table public.notification_events from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;

grant select on public.notification_preferences to authenticated;
grant select on public.notification_events to authenticated;
grant update (read_at) on public.notification_events to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;
grant select, insert, update, delete on public.notification_events to service_role;
grant select, insert, update, delete on public.notification_deliveries to service_role;

revoke all on function public.register_push_token(text, text, uuid, text) from public;
revoke all on function public.unregister_push_token(text) from public;
revoke all on function public.claim_notification_event(uuid) from public;
grant execute on function public.register_push_token(text, text, uuid, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.claim_notification_event(uuid) to service_role;

revoke all on function private.enqueue_due_event_reminders() from public;
grant execute on function private.enqueue_due_event_reminders() to service_role;

create or replace function private.dispatch_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Güvenli Vault çağrısı ileri hardening migration'ında etkinleştirilir.
  -- Notification event bu aşamada durable outbox içinde kalır.
  return new;
end;
$$;

create trigger notification_events_dispatch_push
after insert on public.notification_events
for each row execute function private.dispatch_notification_event();

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in ('etkinlink-push-outbox-drain', 'etkinlink-event-reminders')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'etkinlink-event-reminders',
  '*/15 * * * *',
  $job$select private.enqueue_due_event_reminders();$job$
);

commit;

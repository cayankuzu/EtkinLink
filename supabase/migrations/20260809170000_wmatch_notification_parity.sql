begin;

-- WMatch parity: every chat keeps notifications enabled while the Premium
-- privacy controls are locked. The server remains the source of truth.
alter table public.chat_settings
  add column if not exists notifications_enabled boolean not null default true;

update public.chat_settings
set notifications_enabled = true,
    updated_at = now()
where not notifications_enabled;

create or replace function private.enforce_enabled_chat_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_receipts_enabled := true;
  new.online_status_enabled := true;
  new.typing_indicator_enabled := true;
  new.notifications_enabled := true;
  return new;
end;
$$;

drop trigger if exists chat_settings_force_enabled on public.chat_settings;
create trigger chat_settings_force_enabled
before insert or update on public.chat_settings
for each row execute function private.enforce_enabled_chat_settings();

revoke update (notifications_enabled) on public.chat_settings from authenticated;

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
        when target_kind in ('new_match', 'match_ended', 'blocked', 'unblocked')
          then preference.matches_enabled
        when target_kind = 'event_reminder' then preference.event_reminders_enabled
        else preference.system_enabled
      end
      from public.notification_preferences as preference
      where preference.user_id = target_user_id
    ),
    true
  );
$$;

create or replace function private.notify_direct_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
  receiver_notifications_enabled boolean := true;
  notification_tag text;
begin
  select setting.notifications_enabled
  into receiver_notifications_enabled
  from public.chat_settings as setting
  where setting.match_id = new.match_id
    and setting.owner_user_id = new.receiver_id;

  if not coalesce(receiver_notifications_enabled, true) then
    return new;
  end if;

  sender_name := coalesce(private.profile_notification_name(new.sender_id), 'Bir kullanıcı');
  notification_tag := 'match_' || replace(new.match_id::text, '-', '');

  perform private.enqueue_notification(
    new.receiver_id,
    new.sender_id,
    'direct_message',
    'match',
    new.match_id,
    sender_name,
    left(new.body, 180),
    jsonb_build_object(
      'matchId', new.match_id,
      'messageId', new.id,
      'messagePreview', left(new.body, 180),
      'senderName', sender_name,
      'notificationTag', notification_tag,
      'collapseId', notification_tag
    ),
    'messages',
    'direct-message:' || new.id::text
  );
  return new;
end;
$$;

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
  notification_tag text;
begin
  sender_name := coalesce(private.profile_notification_name(new.sender_id), 'Bir kullanıcı');
  notification_tag := 'room_' || replace(new.event_id::text, '-', '');

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
      jsonb_build_object(
        'eventId', new.event_id,
        'messageId', new.id,
        'messagePreview', left(new.body, 180),
        'senderName', sender_name,
        'notificationTag', notification_tag,
        'collapseId', notification_tag
      ),
      'rooms',
      'room-message:' || new.id::text || ':' || attendee.user_id::text
    );
  end loop;
  return new;
end;
$$;

create or replace function private.notify_match_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user1_name text;
  user2_name text;
  actor_name text;
  recipient_id uuid;
  actor_id uuid;
  became_active boolean := false;
  pair_key text;
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
    and new.status = 'blocked'
    and old.status is distinct from 'blocked' then
    actor_id := coalesce(auth.uid(), new.ended_by_user_id);
    recipient_id := case
      when actor_id = new.user1_id then new.user2_id
      when actor_id = new.user2_id then new.user1_id
      else null
    end;
    if recipient_id is not null then
      actor_name := coalesce(private.profile_notification_name(actor_id), 'Bir kullanıcı');
      pair_key := least(new.user1_id, new.user2_id)::text || ':' || greatest(new.user1_id, new.user2_id)::text;
      perform private.enqueue_notification(
        recipient_id,
        actor_id,
        'blocked',
        'match',
        new.id,
        'Sohbet engellendi',
        actor_name || ' ile eşleşmen engelleme nedeniyle kapatıldı.',
        jsonb_build_object('matchId', new.id, 'eventId', new.event_id),
        'matches',
        'blocked:' || pair_key || ':' || txid_current()::text
      );
    end if;
  elsif tg_op = 'UPDATE'
    and old.status = 'blocked'
    and new.status = 'ended' then
    actor_id := coalesce(auth.uid(), new.ended_by_user_id);
    recipient_id := case
      when actor_id = new.user1_id then new.user2_id
      when actor_id = new.user2_id then new.user1_id
      else null
    end;
    if recipient_id is not null then
      actor_name := coalesce(private.profile_notification_name(actor_id), 'Bir kullanıcı');
      pair_key := least(new.user1_id, new.user2_id)::text || ':' || greatest(new.user1_id, new.user2_id)::text;
      perform private.enqueue_notification(
        recipient_id,
        actor_id,
        'unblocked',
        'match',
        new.id,
        'Engel kaldırıldı',
        actor_name || ' engeli kaldırdı. Önceki eşleşme otomatik olarak yeniden açılmadı.',
        jsonb_build_object('matchId', new.id, 'eventId', new.event_id),
        'matches',
        'unblocked:' || pair_key || ':' || txid_current()::text
      );
    end if;
  elsif tg_op = 'UPDATE'
    and new.status = 'ended'
    and old.status is distinct from 'ended' then
    actor_id := new.ended_by_user_id;
    recipient_id := case
      when actor_id = new.user1_id then new.user2_id
      when actor_id = new.user2_id then new.user1_id
      else null
    end;
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

-- Opening a thread also clears its durable notification rows immediately;
-- users no longer need a pull-to-refresh to see the unread state disappear.
create or replace function private.mark_direct_message_notifications_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_events
  set read_at = coalesce(new.read_at, now())
  where user_id = new.receiver_id
    and kind = 'direct_message'
    and route_kind = 'match'
    and route_id = new.match_id
    and read_at is null;
  return new;
end;
$$;

drop trigger if exists direct_messages_mark_notifications_read on public.direct_messages;
create trigger direct_messages_mark_notifications_read
after update of read_at on public.direct_messages
for each row
when (old.read_at is null and new.read_at is not null)
execute function private.mark_direct_message_notifications_read();

create or replace function private.mark_room_notifications_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_events
  set read_at = greatest(created_at, new.last_read_at)
  where user_id = new.user_id
    and kind = 'room_message'
    and route_kind = 'room'
    and route_id = new.event_id
    and created_at <= new.last_read_at
    and read_at is null;
  return new;
end;
$$;

drop trigger if exists room_read_states_mark_notifications_read on public.room_read_states;
create trigger room_read_states_mark_notifications_read
after insert or update of last_read_at on public.room_read_states
for each row execute function private.mark_room_notifications_read();

commit;

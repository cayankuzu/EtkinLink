begin;

-- Chat privacy controls remain enabled until the Premium controls launch.
update public.chat_settings
set read_receipts_enabled = true,
    online_status_enabled = true,
    typing_indicator_enabled = true,
    updated_at = now()
where not read_receipts_enabled
   or not online_status_enabled
   or not typing_indicator_enabled;

alter table public.chat_settings
  alter column read_receipts_enabled set default true,
  alter column online_status_enabled set default true,
  alter column typing_indicator_enabled set default true;

create or replace function private.enforce_enabled_chat_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.read_receipts_enabled := true;
  new.online_status_enabled := true;
  new.typing_indicator_enabled := true;
  return new;
end;
$$;

drop trigger if exists chat_settings_force_enabled on public.chat_settings;
create trigger chat_settings_force_enabled
before insert or update on public.chat_settings
for each row execute function private.enforce_enabled_chat_settings();

drop policy if exists chat_settings_owner_update on public.chat_settings;
revoke update (read_receipts_enabled, online_status_enabled, typing_indicator_enabled)
on public.chat_settings from authenticated;

-- WMatch-compatible private topics: one app-wide presence topic per user and
-- one canonical conversation topic per pair. Every listener is authorized by
-- an active match; a user may only publish their own app presence.
create or replace function private.realtime_presence_user_id(topic text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when topic ~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(topic, ':', 2)::uuid
    else null
  end
$$;

create or replace function private.realtime_conversation_user_id(
  topic text,
  user_position integer
)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when user_position in (1, 2)
      and topic ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(topic, ':', user_position + 1)::uuid
    else null
  end
$$;

drop policy if exists "users receive authorized app presence" on realtime.messages;
create policy "users receive authorized app presence"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'presence'
  and (
    private.realtime_presence_user_id((select realtime.topic())) = (select auth.uid())
    or exists (
      select 1
      from public.matches as match
      where match.status = 'active'
        and (select auth.uid()) in (match.user1_id, match.user2_id)
        and private.realtime_presence_user_id((select realtime.topic())) in (match.user1_id, match.user2_id)
        and private.realtime_presence_user_id((select realtime.topic())) <> (select auth.uid())
    )
  )
);

drop policy if exists "users publish only their app presence" on realtime.messages;
create policy "users publish only their app presence"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and private.realtime_presence_user_id((select realtime.topic())) = (select auth.uid())
);

drop policy if exists "active matches receive pair typing" on realtime.messages;
create policy "active matches receive pair typing"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and match.user1_id = least(
        private.realtime_conversation_user_id((select realtime.topic()), 1),
        private.realtime_conversation_user_id((select realtime.topic()), 2)
      )
      and match.user2_id = greatest(
        private.realtime_conversation_user_id((select realtime.topic()), 1),
        private.realtime_conversation_user_id((select realtime.topic()), 2)
      )
      and (select auth.uid()) in (match.user1_id, match.user2_id)
  )
);

drop policy if exists "active matches publish pair typing" on realtime.messages;
create policy "active matches publish pair typing"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and match.user1_id = least(
        private.realtime_conversation_user_id((select realtime.topic()), 1),
        private.realtime_conversation_user_id((select realtime.topic()), 2)
      )
      and match.user2_id = greatest(
        private.realtime_conversation_user_id((select realtime.topic()), 1),
        private.realtime_conversation_user_id((select realtime.topic()), 2)
      )
      and (select auth.uid()) in (match.user1_id, match.user2_id)
  )
);

-- A block always locks every relationship between the pair. Unblocking keeps
-- those relationships ended, matching WMatch's non-reactivation rule.
create or replace function public.block_user(target_user_id uuid)
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
  if current_user_id = target_user_id then
    raise exception using errcode = '23514', message = 'Kendini engelleyemezsin.';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = target_user_id and profile.account_disabled_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'Kullanıcı bulunamadı.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, target_user_id)::text || ':' || greatest(current_user_id, target_user_id)::text,
      0
    )
  );

  insert into public.user_blocks (blocker_id, blocked_id)
  values (current_user_id, target_user_id)
  on conflict do nothing;

  delete from public.event_likes
  where (user_id = current_user_id and liked_user_id = target_user_id)
     or (user_id = target_user_id and liked_user_id = current_user_id);

  update public.matches as match
  set status = 'blocked',
      ended_at = coalesce(match.ended_at, now()),
      ended_by_user_id = coalesce(match.ended_by_user_id, current_user_id),
      updated_at = now()
  where match.user1_id = least(current_user_id, target_user_id)
    and match.user2_id = greatest(current_user_id, target_user_id);
end;
$$;

drop function if exists public.delete_match_chat(uuid);

create function public.delete_match_chat(
  target_match_id uuid,
  delete_mode text default 'end'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
  other_user_id uuid;
begin
  if delete_mode not in ('end', 'block') then
    raise exception using errcode = '22023', message = 'Geçersiz sohbet silme seçeneği.';
  end if;

  select * into target_match
  from public.matches
  where id = target_match_id
  for update;

  if current_user_id is null
    or not found
    or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;

  other_user_id := case
    when current_user_id = target_match.user1_id then target_match.user2_id
    else target_match.user1_id
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, other_user_id)::text || ':' || greatest(current_user_id, other_user_id)::text,
      0
    )
  );

  if delete_mode = 'block' then
    insert into public.user_blocks (blocker_id, blocked_id)
    values (current_user_id, other_user_id)
    on conflict do nothing;

    delete from public.event_likes
    where (user_id = current_user_id and liked_user_id = other_user_id)
       or (user_id = other_user_id and liked_user_id = current_user_id);

    update public.matches as match
    set status = 'blocked',
        ended_at = coalesce(match.ended_at, now()),
        ended_by_user_id = coalesce(match.ended_by_user_id, current_user_id),
        user1_chat_deleted_at = case
          when match.user1_id = current_user_id then now()
          else match.user1_chat_deleted_at
        end,
        user2_chat_deleted_at = case
          when match.user2_id = current_user_id then now()
          else match.user2_chat_deleted_at
        end,
        user1_chat_cleared_at = case
          when match.user1_id = current_user_id then now()
          else match.user1_chat_cleared_at
        end,
        user2_chat_cleared_at = case
          when match.user2_id = current_user_id then now()
          else match.user2_chat_cleared_at
        end,
        updated_at = now()
    where match.user1_id = least(current_user_id, other_user_id)
      and match.user2_id = greatest(current_user_id, other_user_id);
  else
    delete from public.event_likes
    where event_id = target_match.event_id
      and (
        (user_id = target_match.user1_id and liked_user_id = target_match.user2_id)
        or (user_id = target_match.user2_id and liked_user_id = target_match.user1_id)
      );

    update public.matches as match
    set status = case
          when private.is_blocked(match.user1_id, match.user2_id) then 'blocked'::public.match_status
          else 'ended'::public.match_status
        end,
        ended_at = coalesce(match.ended_at, now()),
        ended_by_user_id = coalesce(match.ended_by_user_id, current_user_id),
        user1_chat_deleted_at = case
          when match.user1_id = current_user_id then now()
          else match.user1_chat_deleted_at
        end,
        user2_chat_deleted_at = case
          when match.user2_id = current_user_id then now()
          else match.user2_chat_deleted_at
        end,
        user1_chat_cleared_at = case
          when match.user1_id = current_user_id then now()
          else match.user1_chat_cleared_at
        end,
        user2_chat_cleared_at = case
          when match.user2_id = current_user_id then now()
          else match.user2_chat_cleared_at
        end,
        updated_at = now()
    where match.id = target_match_id;
  end if;
end;
$$;

-- Repair chats removed under the old "hide only" rule and blocked rows that
-- predate explicit end metadata.
update public.matches as match
set status = 'ended',
    ended_at = coalesce(match.ended_at, match.updated_at, now()),
    ended_by_user_id = coalesce(
      match.ended_by_user_id,
      case
        when match.user1_chat_deleted_at is not null then match.user1_id
        else match.user2_id
      end
    ),
    updated_at = now()
where match.status = 'active'
  and (match.user1_chat_deleted_at is not null or match.user2_chat_deleted_at is not null);

update public.matches as match
set ended_at = coalesce(match.ended_at, match.updated_at, now()),
    updated_at = now()
where match.status = 'blocked'
  and match.ended_at is null;

revoke all on function public.delete_match_chat(uuid, text) from public;
grant execute on function public.delete_match_chat(uuid, text) to authenticated;

commit;

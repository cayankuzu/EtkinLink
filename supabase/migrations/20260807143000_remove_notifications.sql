-- Notifications are intentionally not a product feature. Keep the core
-- matching, messaging and blocking operations while removing every enqueue.

create or replace function public.swipe_event_candidate(
  target_event_id uuid,
  target_user_id uuid,
  action public.swipe_action,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  canonical_user1 uuid;
  canonical_user2 uuid;
  request_hash text;
  previous private.idempotency_records;
  quota public.swipe_quotas;
  reverse_like boolean;
  new_match public.matches;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if current_user_id = target_user_id then
    raise exception using errcode = '23514', message = 'Kendini değerlendiremezsin.';
  end if;

  request_hash := encode(
    extensions.digest(
      target_event_id::text || ':' || target_user_id::text || ':' || action::text,
      'sha256'
    ),
    'hex'
  );
  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'swipe_event_candidate'
    and record.request_id = $4;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı istek kimliği farklı veriyle kullanılamaz.';
    end if;
    return previous.response;
  end if;

  if private.is_blocked(current_user_id, target_user_id) then
    raise exception using errcode = '42501', message = 'Bu kullanıcıyla etkileşim kuramazsın.';
  end if;
  if not exists (
    select 1 from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = current_user_id
      and attendee.status = 'joined'
      and attendee.matching_enabled
  ) or not exists (
    select 1 from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = target_user_id
      and attendee.status = 'joined'
      and attendee.matching_enabled
  ) then
    raise exception using
      errcode = '42501',
      message = 'Eşleşme yalnızca aynı etkinliğin aktif katılımcıları arasında kullanılabilir.';
  end if;
  if not private.is_profile_ready(current_user_id)
    or not private.is_profile_ready(target_user_id)
    or not exists (
      select 1 from public.profiles as profile
      where profile.id = current_user_id and profile.onboarding_completed
    )
    or not exists (
      select 1 from public.profiles as profile
      where profile.id = target_user_id and profile.onboarding_completed
    ) then
    raise exception using
      errcode = '23514',
      message = 'Her iki profil de eşleşmeye hazır olmalı.';
  end if;

  canonical_user1 := least(current_user_id, target_user_id);
  canonical_user2 := greatest(current_user_id, target_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_event_id::text || canonical_user1::text || canonical_user2::text,
      0
    )
  );

  if action = 'like' and exists (
    select 1 from public.event_likes
    where event_id = target_event_id
      and user_id = current_user_id
      and liked_user_id = target_user_id
  ) then
    result := jsonb_build_object('status', 'liked', 'duplicate', true);
  elsif action = 'pass' and exists (
    select 1 from public.event_passes
    where event_id = target_event_id
      and user_id = current_user_id
      and passed_user_id = target_user_id
  ) then
    result := jsonb_build_object('status', 'passed', 'duplicate', true);
  else
    quota := private.consume_swipe_quota(current_user_id, action);
    if action = 'pass' then
      insert into public.event_passes (event_id, user_id, passed_user_id)
      values (target_event_id, current_user_id, target_user_id);
      result := jsonb_build_object(
        'status', 'passed', 'matched', false, 'quota', to_jsonb(quota)
      );
    else
      insert into public.event_likes (event_id, user_id, liked_user_id)
      values (target_event_id, current_user_id, target_user_id);

      select exists (
        select 1 from public.event_likes
        where event_id = target_event_id
          and user_id = target_user_id
          and liked_user_id = current_user_id
      ) into reverse_like;

      if reverse_like then
        insert into public.matches (
          event_id,
          user1_id,
          user2_id,
          status,
          first_like_by_user_id,
          accepted_by_user_id,
          ended_at,
          ended_by_user_id,
          user1_chat_deleted_at,
          user2_chat_deleted_at,
          user1_chat_cleared_at,
          user2_chat_cleared_at
        ) values (
          target_event_id,
          canonical_user1,
          canonical_user2,
          'active',
          target_user_id,
          current_user_id,
          null,
          null,
          null,
          null,
          now(),
          now()
        )
        on conflict (event_id, user1_id, user2_id) do update set
          status = 'active',
          accepted_by_user_id = current_user_id,
          ended_at = null,
          ended_by_user_id = null,
          user1_chat_deleted_at = null,
          user2_chat_deleted_at = null,
          user1_chat_cleared_at = now(),
          user2_chat_cleared_at = now(),
          updated_at = now()
        returning * into new_match;

        insert into public.chat_settings (match_id, owner_user_id)
        values
          (new_match.id, canonical_user1),
          (new_match.id, canonical_user2)
        on conflict do nothing;
        insert into public.chat_pair_summaries (match_id)
        values (new_match.id)
        on conflict do nothing;
        update public.swipe_quotas
        set reward_like_swipes = least(reward_like_swipes + 1, 13),
            updated_at = now()
        where user_id in (canonical_user1, canonical_user2);
        result := jsonb_build_object(
          'status', 'matched',
          'matched', true,
          'match_id', new_match.id,
          'quota', to_jsonb(quota)
        );
      else
        result := jsonb_build_object(
          'status', 'liked', 'matched', false, 'quota', to_jsonb(quota)
        );
      end if;
    end if;
  end if;

  insert into private.idempotency_records (
    user_id,
    operation,
    request_id,
    payload_hash,
    response
  ) values (
    current_user_id,
    'swipe_event_candidate',
    request_id,
    request_hash,
    result
  );
  return result;
end;
$$;

create or replace function public.send_direct_message(
  target_match_id uuid,
  message_body text,
  client_message_id uuid
)
returns public.direct_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_client_message_id uuid := send_direct_message.client_message_id;
  normalized_body text := btrim(message_body);
  target_match public.matches;
  target_receiver uuid;
  result public.direct_messages;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  select * into target_match
  from public.matches
  where id = target_match_id
  for update;

  if not found or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;
  if target_match.status <> 'active'
    or target_match.ended_at is not null
    or private.is_blocked(target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = '42501', message = 'Bu sohbet artık mesaj kabul etmiyor.';
  end if;
  if (current_user_id = target_match.user1_id and target_match.user1_chat_deleted_at is not null)
    or (current_user_id = target_match.user2_id and target_match.user2_chat_deleted_at is not null) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;

  target_receiver := case
    when current_user_id = target_match.user1_id then target_match.user2_id
    else target_match.user1_id
  end;

  insert into public.direct_messages (
    match_id,
    sender_id,
    receiver_id,
    body,
    client_message_id
  ) values (
    target_match_id,
    current_user_id,
    target_receiver,
    normalized_body,
    requested_client_message_id
  )
  on conflict on constraint direct_messages_sender_id_client_message_id_key do nothing
  returning * into result;

  if result.id is null then
    select message.* into strict result
    from public.direct_messages as message
    where message.sender_id = current_user_id
      and message.client_message_id = requested_client_message_id;

    if result.match_id <> target_match_id
      or result.receiver_id <> target_receiver
      or result.body <> normalized_body then
      raise exception using
        errcode = '23505',
        message = 'Aynı işlem anahtarı farklı bir mesaj için kullanılamaz.';
    end if;
  end if;

  return result;
end;
$$;

create or replace function public.end_match(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
begin
  select * into target_match
  from public.matches
  where id = target_match_id
  for update;
  if current_user_id is null
    or not found
    or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Eşleşme bulunamadı.';
  end if;

  update public.matches
  set status = 'ended',
      ended_at = now(),
      ended_by_user_id = current_user_id,
      updated_at = now()
  where id = target_match_id;
  delete from public.event_likes
  where event_id = target_match.event_id
    and (
      (user_id = target_match.user1_id and liked_user_id = target_match.user2_id)
      or (user_id = target_match.user2_id and liked_user_id = target_match.user1_id)
    );
end;
$$;

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
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
  get diagnostics changed = row_count;
  if changed = 0 then return; end if;

  delete from public.event_likes
  where (user_id = current_user_id and liked_user_id = target_user_id)
     or (user_id = target_user_id and liked_user_id = current_user_id);
  update public.matches
  set status = 'blocked', updated_at = now()
  where user1_id = least(current_user_id, target_user_id)
    and user2_id = greatest(current_user_id, target_user_id);
end;
$$;

create or replace function public.unblock_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, target_user_id)::text || ':' || greatest(current_user_id, target_user_id)::text,
      0
    )
  );
  delete from public.user_blocks
  where blocker_id = current_user_id and blocked_id = target_user_id;
  get diagnostics changed = row_count;
  if changed = 0 then return; end if;

  update public.matches as match
  set status = 'ended',
      ended_at = coalesce(match.ended_at, now()),
      updated_at = now()
  where match.user1_id = least(current_user_id, target_user_id)
    and match.user2_id = greatest(current_user_id, target_user_id)
    and not private.is_blocked(current_user_id, target_user_id)
    and match.status = 'blocked';
end;
$$;

alter table public.chat_settings
  drop column if exists notifications_enabled;

drop table if exists public.push_tokens;
drop table if exists public.notification_events;
drop type if exists public.notification_kind;
drop type if exists public.delivery_status;

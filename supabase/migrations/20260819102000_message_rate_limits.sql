begin;

create index if not exists direct_messages_sender_created_idx
  on public.direct_messages (sender_id, created_at desc);
create index if not exists direct_messages_sender_match_created_idx
  on public.direct_messages (sender_id, match_id, created_at desc);
create index if not exists room_messages_sender_created_idx
  on public.room_messages (sender_id, created_at desc);
create index if not exists room_messages_sender_event_created_idx
  on public.room_messages (sender_id, event_id, created_at desc);

create or replace function private.assert_message_rate_limit(
  target_user_id uuid,
  target_scope text,
  target_scope_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  global_message_count integer;
  scope_message_count integer;
begin
  if target_scope not in ('direct', 'room') then
    raise exception using errcode = '22023', message = 'Geçersiz mesaj kapsamı.';
  end if;

  -- Aynı kullanıcının eşzamanlı istekleri seri hale getirilerek count/insert
  -- yarışının limiti aşmasına izin verilmez.
  perform pg_advisory_xact_lock(
    hashtextextended('message-rate:' || target_user_id::text, 0)
  );

  select
    (
      select count(*)
      from public.direct_messages as direct_message
      where direct_message.sender_id = target_user_id
        and direct_message.created_at > now() - interval '1 minute'
    ) + (
      select count(*)
      from public.room_messages as room_message
      where room_message.sender_id = target_user_id
        and room_message.created_at > now() - interval '1 minute'
    )
  into global_message_count;

  if global_message_count >= 45 then
    raise exception using
      errcode = 'P0001',
      message = 'Çok hızlı mesaj gönderiyorsun. Kısa bir süre bekleyip tekrar dene.';
  end if;

  if target_scope = 'direct' then
    select count(*) into scope_message_count
    from public.direct_messages as direct_message
    where direct_message.sender_id = target_user_id
      and direct_message.match_id = target_scope_id
      and direct_message.created_at > now() - interval '10 seconds';
  else
    select count(*) into scope_message_count
    from public.room_messages as room_message
    where room_message.sender_id = target_user_id
      and room_message.event_id = target_scope_id
      and room_message.created_at > now() - interval '10 seconds';
  end if;

  if scope_message_count >= 8 then
    raise exception using
      errcode = 'P0001',
      message = 'Bu sohbete çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.';
  end if;
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
  if char_length(normalized_body) not between 1 and 700 then
    raise exception using errcode = '22023', message = 'Mesaj 1-700 karakter olmalı.';
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

  select message.* into result
  from public.direct_messages as message
  where message.sender_id = current_user_id
    and message.client_message_id = requested_client_message_id;
  if found then
    if result.match_id <> target_match_id
      or result.receiver_id <> target_receiver
      or result.body <> normalized_body then
      raise exception using
        errcode = '23505',
        message = 'Aynı işlem anahtarı farklı bir mesaj için kullanılamaz.';
    end if;
    return result;
  end if;

  perform private.assert_message_rate_limit(
    current_user_id,
    'direct',
    target_match_id
  );

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
  end if;

  return result;
end;
$$;

create or replace function public.send_room_message(
  target_event_id uuid,
  message_body text,
  client_message_id uuid
)
returns public.room_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_client_message_id uuid := send_room_message.client_message_id;
  normalized_body text := btrim(message_body);
  result public.room_messages;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if char_length(normalized_body) not between 1 and 700 then
    raise exception using errcode = '22023', message = 'Mesaj 1-700 karakter olmalı.';
  end if;
  if not public.is_event_room_open(target_event_id) then
    raise exception using errcode = '42501', message = 'Bu etkinliğin sohbet dönemi kapalı.';
  end if;
  if not exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = current_user_id
      and attendee.status = 'joined'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Odaya yalnızca etkinlik katılımcıları yazabilir.';
  end if;

  select message.* into result
  from public.room_messages as message
  where message.sender_id = current_user_id
    and message.client_message_id = requested_client_message_id;
  if found then
    if result.event_id <> target_event_id or result.body <> normalized_body then
      raise exception using
        errcode = '23505',
        message = 'Aynı işlem anahtarı farklı bir mesaj için kullanılamaz.';
    end if;
    return result;
  end if;

  perform private.assert_message_rate_limit(
    current_user_id,
    'room',
    target_event_id
  );

  insert into public.room_messages (
    event_id,
    sender_id,
    body,
    client_message_id
  ) values (
    target_event_id,
    current_user_id,
    normalized_body,
    requested_client_message_id
  )
  on conflict on constraint room_messages_sender_id_client_message_id_key do nothing
  returning * into result;

  if result.id is null then
    select message.* into strict result
    from public.room_messages as message
    where message.sender_id = current_user_id
      and message.client_message_id = requested_client_message_id;
  end if;

  return result;
end;
$$;

revoke all on function private.assert_message_rate_limit(uuid, text, uuid) from public;
revoke all on function public.send_direct_message(uuid, text, uuid) from public;
revoke all on function public.send_room_message(uuid, text, uuid) from public;
grant execute on function public.send_direct_message(uuid, text, uuid) to authenticated;
grant execute on function public.send_room_message(uuid, text, uuid) to authenticated;

comment on function private.assert_message_rate_limit(uuid, text, uuid) is
  'Kullanıcı başına 45/dk ve sohbet başına 8/10sn mesaj limiti uygular; idempotent tekrarlar bu limite dahil edilmez.';

commit;

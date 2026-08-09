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
  )
  values (
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
    return result;
  end if;

  if exists (
    select 1
    from public.chat_settings as setting
    where setting.match_id = target_match_id
      and setting.owner_user_id = target_receiver
      and setting.notifications_enabled
  ) then
    insert into public.notification_events (
      user_id,
      actor_user_id,
      kind,
      route_kind,
      route_id,
      title,
      body
    )
    values (
      target_receiver,
      current_user_id,
      'direct_message',
      'match',
      target_match_id,
      'Yeni mesaj',
      left(result.body, 120)
    );
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

  insert into public.room_messages (
    event_id,
    sender_id,
    body,
    client_message_id
  )
  values (
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

    if result.event_id <> target_event_id or result.body <> normalized_body then
      raise exception using
        errcode = '23505',
        message = 'Aynı işlem anahtarı farklı bir mesaj için kullanılamaz.';
    end if;
  end if;

  return result;
end;
$$;

create or replace function public.replace_profile_photos(storage_paths text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  previous_paths text[];
  item text;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if cardinality(storage_paths) not between 3 and 6 then
    raise exception using errcode = '23514', message = 'En az 3, en fazla 6 fotoğraf gerekir.';
  end if;
  if cardinality(storage_paths) <> cardinality(array(select distinct unnest(storage_paths))) then
    raise exception using errcode = '23505', message = 'Aynı fotoğraf birden fazla kullanılamaz.';
  end if;

  foreach item in array storage_paths loop
    if item !~ ('^' || current_user_id::text || '/[0-9a-f-]+\.(jpg|png|webp|heic|heif)$') then
      raise exception using errcode = '42501', message = 'Geçersiz fotoğraf yolu.';
    end if;
  end loop;

  select coalesce(array_agg(storage_path order by position), '{}'::text[])
  into previous_paths
  from public.profile_photos
  where user_id = current_user_id;

  delete from public.profile_photos where user_id = current_user_id;
  for item_index in 1..cardinality(storage_paths) loop
    insert into public.profile_photos (user_id, storage_path, position)
    values (current_user_id, storage_paths[item_index], item_index - 1);
  end loop;

  return previous_paths;
end;
$$;

revoke all on function public.send_direct_message(uuid, text, uuid) from public;
revoke all on function public.send_room_message(uuid, text, uuid) from public;
revoke all on function public.replace_profile_photos(text[]) from public;
grant execute on function public.send_direct_message(uuid, text, uuid) to authenticated;
grant execute on function public.send_room_message(uuid, text, uuid) to authenticated;
grant execute on function public.replace_profile_photos(text[]) to authenticated;

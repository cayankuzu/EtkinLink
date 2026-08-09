begin;

create or replace function public.list_room_messages(
  target_event_id uuid,
  page_size integer default 35,
  cursor_created_at timestamptz default null,
  cursor_message_id uuid default null
)
returns table (
  id uuid,
  event_id uuid,
  sender_id uuid,
  sender_name text,
  sender_photo_path text,
  body text,
  client_message_id uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if not exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = auth.uid()
      and attendee.status = 'joined'
  ) then
    raise exception using errcode = '42501', message = 'Bu oda için erişimin yok.';
  end if;

  return query
  select
    message.id,
    message.event_id,
    message.sender_id,
    coalesce(profile.full_name, 'EtkinLink kullanıcısı'),
    photo.storage_path,
    message.body,
    message.client_message_id,
    message.created_at
  from public.room_messages message
  join public.profiles profile on profile.id = message.sender_id
  left join lateral (
    select profile_photo.storage_path
    from public.profile_photos profile_photo
    where profile_photo.user_id = message.sender_id
      and profile_photo.position = 0
    limit 1
  ) photo on true
  where message.event_id = target_event_id
    and not private.is_blocked(auth.uid(), message.sender_id)
    and (
      cursor_created_at is null
      or (message.created_at, message.id) < (cursor_created_at, cursor_message_id)
    )
  order by message.created_at desc, message.id desc
  limit least(greatest(page_size, 1), 100);
end;
$$;

revoke all on function public.list_room_messages(uuid, integer, timestamptz, uuid) from public;
grant execute on function public.list_room_messages(uuid, integer, timestamptz, uuid) to authenticated;

commit;

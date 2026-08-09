begin;

create or replace function public.list_joined_rooms(
  page_size integer default 30,
  cursor_joined_at timestamptz default null,
  cursor_event_id uuid default null
)
returns table (
  event_id uuid,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  image_url text,
  city text,
  venue text,
  joined_at timestamptz,
  matching_enabled boolean,
  room_open boolean,
  unread_count bigint,
  last_message text,
  last_message_is_mine boolean,
  last_message_sender_name text,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    event.id,
    event.title,
    event.start_at,
    event.end_at,
    event.image_url,
    event.city,
    event.venue,
    attendee.joined_at,
    attendee.matching_enabled,
    public.is_event_room_open(event.id),
    (
      select count(*)
      from public.room_messages message
      where message.event_id = event.id
        and message.sender_id <> auth.uid()
        and message.created_at > coalesce(read_state.last_read_at, attendee.joined_at)
        and not private.is_blocked(auth.uid(), message.sender_id)
    ),
    latest.body,
    coalesce(latest.sender_id = auth.uid(), false),
    latest.sender_name,
    latest.created_at
  from public.event_attendees attendee
  join public.events event on event.id = attendee.event_id
  left join public.room_read_states read_state
    on read_state.event_id = event.id
   and read_state.user_id = auth.uid()
  left join lateral (
    select
      message.body,
      message.sender_id,
      profile.full_name as sender_name,
      message.created_at
    from public.room_messages message
    left join public.profiles profile on profile.id = message.sender_id
    where message.event_id = event.id
      and not private.is_blocked(auth.uid(), message.sender_id)
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  where auth.uid() is not null
    and attendee.user_id = auth.uid()
    and attendee.status = 'joined'
    and (
      cursor_joined_at is null
      or (attendee.joined_at, event.id) < (cursor_joined_at, cursor_event_id)
    )
  order by
    public.is_event_room_open(event.id) desc,
    coalesce(latest.created_at, attendee.joined_at) desc,
    event.id desc
  limit least(greatest(page_size, 1), 50);
$$;

revoke all on function public.list_joined_rooms(integer, timestamptz, uuid) from public;
grant execute on function public.list_joined_rooms(integer, timestamptz, uuid) to authenticated;

commit;

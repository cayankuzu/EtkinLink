create or replace function public.list_saved_events(
  page_size integer default 30,
  cursor_saved_at timestamptz default null,
  cursor_event_id uuid default null
)
returns table (
  id uuid,
  external_id bigint,
  source_url text,
  title text,
  summary text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  venue text,
  city text,
  district text,
  address text,
  image_url text,
  categories text[],
  attendee_count bigint,
  joined boolean,
  saved boolean,
  room_open boolean,
  saved_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.external_id, e.source_url, e.title, e.summary, e.description,
    e.start_at, e.end_at, e.venue, e.city, e.district, e.address, e.image_url, e.categories,
    (select count(*) from public.event_attendees a where a.event_id = e.id and a.status = 'joined'),
    exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status = 'joined'),
    true,
    public.is_event_room_open(e.id),
    s.created_at
  from public.saved_events s
  join public.events e on e.id = s.event_id
  where s.user_id = auth.uid()
    and (cursor_saved_at is null or (s.created_at, e.id) < (cursor_saved_at, cursor_event_id))
  order by s.created_at desc, e.id desc
  limit least(greatest(page_size, 1), 40);
$$;

revoke all on function public.list_saved_events(integer, timestamptz, uuid) from public;
grant execute on function public.list_saved_events(integer, timestamptz, uuid) to authenticated;

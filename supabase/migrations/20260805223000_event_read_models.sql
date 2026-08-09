begin;

create type public.event_sort as enum ('upcoming', 'newest');

create or replace function public.search_events(
  search_text text default null,
  city_filter text default null,
  category_filter text default null,
  starts_after timestamptz default now(),
  starts_before timestamptz default null,
  sort_by public.event_sort default 'upcoming',
  page_size integer default 20,
  cursor_start_at timestamptz default null,
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
  room_open boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id, e.external_id, e.source_url, e.title, e.summary, e.description,
    e.start_at, e.end_at, e.venue, e.city, e.district, e.address, e.image_url, e.categories,
    (select count(*) from public.event_attendees a where a.event_id = e.id and a.status = 'joined') as attendee_count,
    exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status = 'joined') as joined,
    exists (select 1 from public.saved_events s where s.event_id = e.id and s.user_id = auth.uid()) as saved,
    public.is_event_room_open(e.id) as room_open
  from public.events e
  where not e.is_cancelled
    and e.start_at >= coalesce(starts_after, '-infinity'::timestamptz)
    and (starts_before is null or e.start_at < starts_before)
    and (city_filter is null or city_filter = '' or e.city = city_filter)
    and (category_filter is null or category_filter = '' or category_filter = any(e.categories))
    and (
      search_text is null or btrim(search_text) = ''
      or extensions.unaccent(lower(e.title)) like '%' || extensions.unaccent(lower(btrim(search_text))) || '%'
      or extensions.unaccent(lower(coalesce(e.venue, ''))) like '%' || extensions.unaccent(lower(btrim(search_text))) || '%'
      or extensions.unaccent(lower(coalesce(e.city, ''))) like '%' || extensions.unaccent(lower(btrim(search_text))) || '%'
    )
    and (
      cursor_start_at is null
      or (sort_by = 'upcoming' and (e.start_at, e.id) > (cursor_start_at, cursor_event_id))
      or (sort_by = 'newest' and (e.created_at, e.id) < (cursor_start_at, cursor_event_id))
    )
  order by
    case when sort_by = 'upcoming' then e.start_at end asc,
    case when sort_by = 'newest' then e.created_at end desc,
    e.id asc
  limit least(greatest(page_size, 1), 40);
$$;

create or replace function public.get_event_detail(target_event_id uuid)
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
  room_open boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id, e.external_id, e.source_url, e.title, e.summary, e.description,
    e.start_at, e.end_at, e.venue, e.city, e.district, e.address, e.image_url, e.categories,
    (select count(*) from public.event_attendees a where a.event_id = e.id and a.status = 'joined') as attendee_count,
    exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status = 'joined') as joined,
    exists (select 1 from public.saved_events s where s.event_id = e.id and s.user_id = auth.uid()) as saved,
    public.is_event_room_open(e.id) as room_open
  from public.events e
  where e.id = target_event_id;
$$;

create or replace function public.list_joined_events(
  include_left boolean default false,
  page_size integer default 30,
  cursor_joined_at timestamptz default null,
  cursor_event_id uuid default null
)
returns table (
  id uuid,
  external_id bigint,
  source_url text,
  title text,
  summary text,
  start_at timestamptz,
  end_at timestamptz,
  venue text,
  city text,
  image_url text,
  categories text[],
  attendee_count bigint,
  joined boolean,
  saved boolean,
  room_open boolean,
  joined_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id, e.external_id, e.source_url, e.title, e.summary, e.start_at, e.end_at,
    e.venue, e.city, e.image_url, e.categories,
    (select count(*) from public.event_attendees all_a where all_a.event_id = e.id and all_a.status = 'joined') as attendee_count,
    a.status = 'joined' as joined,
    exists (select 1 from public.saved_events s where s.event_id = e.id and s.user_id = auth.uid()) as saved,
    public.is_event_room_open(e.id) as room_open,
    a.joined_at
  from public.event_attendees a
  join public.events e on e.id = a.event_id
  where a.user_id = auth.uid()
    and (include_left or a.status = 'joined')
    and (cursor_joined_at is null or (a.joined_at, e.id) < (cursor_joined_at, cursor_event_id))
  order by a.joined_at desc, e.id desc
  limit least(greatest(page_size, 1), 50);
$$;

create or replace function public.list_profile_events(
  profile_user_id uuid,
  list_kind text,
  page_size integer default 20,
  page_offset integer default 0
)
returns table (
  id uuid,
  title text,
  start_at timestamptz,
  venue text,
  city text,
  image_url text,
  categories text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.id, e.title, e.start_at, e.venue, e.city, e.image_url, e.categories
  from public.event_attendees a
  join public.events e on e.id = a.event_id
  where a.user_id = profile_user_id
    and a.status = 'joined'
    and (
      (list_kind = 'upcoming' and coalesce(e.end_at, e.start_at) >= now())
      or (list_kind = 'past' and coalesce(e.end_at, e.start_at) < now())
    )
  order by
    case when list_kind = 'upcoming' then e.start_at end asc,
    case when list_kind = 'past' then e.start_at end desc,
    e.id
  limit least(greatest(page_size, 1), 40)
  offset greatest(page_offset, 0);
$$;

revoke all on function public.search_events(text, text, text, timestamptz, timestamptz, public.event_sort, integer, timestamptz, uuid) from public;
revoke all on function public.get_event_detail(uuid) from public;
revoke all on function public.list_joined_events(boolean, integer, timestamptz, uuid) from public;
revoke all on function public.list_profile_events(uuid, text, integer, integer) from public;

grant execute on function public.search_events(text, text, text, timestamptz, timestamptz, public.event_sort, integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_event_detail(uuid) to authenticated;
grant execute on function public.list_joined_events(boolean, integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_profile_events(uuid, text, integer, integer) to authenticated;

commit;

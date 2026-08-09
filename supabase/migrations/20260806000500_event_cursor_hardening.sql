begin;

drop function if exists public.search_events(
  text, text, text, timestamptz, timestamptz, public.event_sort,
  integer, timestamptz, uuid
);

create function public.search_events(
  search_text text default null,
  city_filter text default null,
  category_filter text default null,
  starts_after timestamptz default now(),
  starts_before timestamptz default null,
  sort_by public.event_sort default 'upcoming',
  page_size integer default 20,
  cursor_sort_at timestamptz default null,
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
  sort_cursor_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.external_id,
    e.source_url,
    e.title,
    e.summary,
    e.description,
    e.start_at,
    e.end_at,
    e.venue,
    e.city,
    e.district,
    e.address,
    e.image_url,
    e.categories,
    (select count(*) from public.event_attendees a where a.event_id = e.id and a.status = 'joined'),
    exists (select 1 from public.event_attendees a where a.event_id = e.id and a.user_id = auth.uid() and a.status = 'joined'),
    exists (select 1 from public.saved_events s where s.event_id = e.id and s.user_id = auth.uid()),
    public.is_event_room_open(e.id),
    case when sort_by = 'upcoming' then e.start_at else e.created_at end
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
      cursor_sort_at is null
      or (sort_by = 'upcoming' and (e.start_at, e.id) > (cursor_sort_at, cursor_event_id))
      or (sort_by = 'newest' and (e.created_at, e.id) < (cursor_sort_at, cursor_event_id))
    )
  order by
    case when sort_by = 'upcoming' then e.start_at end asc,
    case when sort_by = 'upcoming' then e.id end asc,
    case when sort_by = 'newest' then e.created_at end desc,
    case when sort_by = 'newest' then e.id end desc
  limit least(greatest(page_size, 1), 40);
$$;

revoke all on function public.search_events(
  text, text, text, timestamptz, timestamptz, public.event_sort,
  integer, timestamptz, uuid
) from public;
grant execute on function public.search_events(
  text, text, text, timestamptz, timestamptz, public.event_sort,
  integer, timestamptz, uuid
) to authenticated;

commit;

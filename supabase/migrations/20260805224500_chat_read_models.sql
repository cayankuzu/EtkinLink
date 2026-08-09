begin;

create table public.room_read_states (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create trigger room_read_states_set_updated_at before update on public.room_read_states
for each row execute function private.set_updated_at();

create index room_read_states_user_idx on public.room_read_states (user_id, updated_at desc);

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
  last_message_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id, e.title, e.start_at, e.end_at, e.image_url, e.city, e.venue,
    a.joined_at, a.matching_enabled, public.is_event_room_open(e.id),
    (
      select count(*) from public.room_messages rm
      where rm.event_id = e.id
        and rm.sender_id <> auth.uid()
        and rm.created_at > coalesce(rs.last_read_at, a.joined_at)
    ) as unread_count,
    (select max(rm.created_at) from public.room_messages rm where rm.event_id = e.id) as last_message_at
  from public.event_attendees a
  join public.events e on e.id = a.event_id
  left join public.room_read_states rs on rs.event_id = e.id and rs.user_id = auth.uid()
  where a.user_id = auth.uid()
    and a.status = 'joined'
    and (cursor_joined_at is null or (a.joined_at, e.id) < (cursor_joined_at, cursor_event_id))
  order by
    public.is_event_room_open(e.id) desc,
    coalesce((select max(rm.created_at) from public.room_messages rm where rm.event_id = e.id), a.joined_at) desc,
    e.id desc
  limit least(greatest(page_size, 1), 50);
$$;

create or replace function public.mark_room_read(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if not exists (
    select 1 from public.event_attendees a
    where a.event_id = target_event_id and a.user_id = current_user_id
  ) then raise exception using errcode = '42501', message = 'Bu oda için erişimin yok.';
  end if;
  insert into public.room_read_states (event_id, user_id, last_read_at)
  values (target_event_id, current_user_id, now())
  on conflict (event_id, user_id) do update set last_read_at = now(), updated_at = now();
end;
$$;

create or replace function public.list_matches(
  status_filter text default 'all',
  page_size integer default 30,
  cursor_activity_at timestamptz default null,
  cursor_match_id uuid default null
)
returns table (
  match_id uuid,
  event_id uuid,
  event_title text,
  other_user_id uuid,
  other_full_name text,
  other_username text,
  other_birth_date date,
  other_gender public.profile_gender,
  other_bio text,
  other_city text,
  other_primary_photo_path text,
  match_status public.match_status,
  match_created_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  unread_count integer,
  activity_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    m.id, m.event_id, e.title,
    other.id, other.full_name, other.username::text, other.birth_date, other.gender,
    other.bio, other.city, photo.storage_path, m.status, m.created_at,
    summary.last_message, summary.last_message_at,
    case when auth.uid() = m.user1_id then coalesce(summary.unread_user1, 0) else coalesce(summary.unread_user2, 0) end,
    coalesce(summary.last_message_at, m.created_at) as activity_at
  from public.matches m
  join public.events e on e.id = m.event_id
  join public.profiles other on other.id = case when auth.uid() = m.user1_id then m.user2_id else m.user1_id end
  left join public.profile_photos photo on photo.user_id = other.id and photo.position = 0
  left join public.chat_pair_summaries summary on summary.match_id = m.id
  where auth.uid() in (m.user1_id, m.user2_id)
    and ((auth.uid() = m.user1_id and m.user1_chat_deleted_at is null) or (auth.uid() = m.user2_id and m.user2_chat_deleted_at is null))
    and (
      status_filter = 'all'
      or (status_filter = 'unread' and (case when auth.uid() = m.user1_id then coalesce(summary.unread_user1, 0) else coalesce(summary.unread_user2, 0) end) > 0)
      or (status_filter = 'read' and (case when auth.uid() = m.user1_id then coalesce(summary.unread_user1, 0) else coalesce(summary.unread_user2, 0) end) = 0 and summary.last_message_id is not null)
      or (status_filter = 'ended' and m.status = 'ended')
      or (status_filter = 'blocked' and m.status = 'blocked')
      or (status_filter = 'active' and m.status = 'active')
    )
    and (
      cursor_activity_at is null
      or (coalesce(summary.last_message_at, m.created_at), m.id) < (cursor_activity_at, cursor_match_id)
    )
  order by coalesce(summary.last_message_at, m.created_at) desc, m.id desc
  limit least(greatest(page_size, 1), 50);
$$;

alter table public.room_read_states enable row level security;
create policy room_read_states_owner_read on public.room_read_states for select to authenticated using (user_id = auth.uid());

grant select on public.room_read_states to authenticated;
revoke all on function public.list_joined_rooms(integer, timestamptz, uuid) from public;
revoke all on function public.mark_room_read(uuid) from public;
revoke all on function public.list_matches(text, integer, timestamptz, uuid) from public;
grant execute on function public.list_joined_rooms(integer, timestamptz, uuid) to authenticated;
grant execute on function public.mark_room_read(uuid) to authenticated;
grant execute on function public.list_matches(text, integer, timestamptz, uuid) to authenticated;

commit;

begin;

alter table public.matches
  add column if not exists compatibility_score smallint not null default 0,
  add column if not exists compatibility_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists matched_at timestamptz;

create or replace function private.calculate_compatibility(
  left_user_id uuid,
  right_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  left_interests as (
    select interest_id as id
    from public.user_interests
    where user_id = left_user_id
  ),
  right_interests as (
    select interest_id as id
    from public.user_interests
    where user_id = right_user_id
  ),
  common_interests as (
    select interest.id, interest.label
    from left_interests as mine
    join right_interests as theirs using (id)
    join public.interests as interest on interest.id = mine.id
  ),
  interest_metrics as (
    select
      (select count(*)::integer from left_interests) as my_count,
      (select count(*)::integer from right_interests) as their_count,
      (select count(*)::integer from common_interests) as common_count,
      (
        select count(distinct id)::integer
        from (
          select id from left_interests
          union all
          select id from right_interests
        ) as combined
      ) as union_count
  ),
  left_upcoming as (
    select attendee.event_id as id
    from public.event_attendees as attendee
    join public.events as event on event.id = attendee.event_id
    where attendee.user_id = left_user_id
      and attendee.status = 'joined'
      and coalesce(event.end_at, event.start_at) >= now()
  ),
  right_upcoming as (
    select attendee.event_id as id
    from public.event_attendees as attendee
    join public.events as event on event.id = attendee.event_id
    where attendee.user_id = right_user_id
      and attendee.status = 'joined'
      and coalesce(event.end_at, event.start_at) >= now()
  ),
  common_upcoming as (
    select event.id, event.title, event.start_at, event.image_url
    from left_upcoming as mine
    join right_upcoming as theirs using (id)
    join public.events as event on event.id = mine.id
  ),
  upcoming_metrics as (
    select
      (select count(*)::integer from left_upcoming) as my_count,
      (select count(*)::integer from right_upcoming) as their_count,
      (select count(*)::integer from common_upcoming) as common_count,
      (
        select count(distinct id)::integer
        from (
          select id from left_upcoming
          union all
          select id from right_upcoming
        ) as combined
      ) as union_count
  ),
  left_attended as (
    select attendee.event_id as id
    from public.event_attendees as attendee
    join public.events as event on event.id = attendee.event_id
    where attendee.user_id = left_user_id
      and attendee.status = 'joined'
      and coalesce(event.end_at, event.start_at) < now()
  ),
  right_attended as (
    select attendee.event_id as id
    from public.event_attendees as attendee
    join public.events as event on event.id = attendee.event_id
    where attendee.user_id = right_user_id
      and attendee.status = 'joined'
      and coalesce(event.end_at, event.start_at) < now()
  ),
  common_attended as (
    select event.id, event.title, event.start_at, event.image_url
    from left_attended as mine
    join right_attended as theirs using (id)
    join public.events as event on event.id = mine.id
  ),
  attended_metrics as (
    select
      (select count(*)::integer from left_attended) as my_count,
      (select count(*)::integer from right_attended) as their_count,
      (select count(*)::integer from common_attended) as common_count,
      (
        select count(distinct id)::integer
        from (
          select id from left_attended
          union all
          select id from right_attended
        ) as combined
      ) as union_count
  ),
  scores as (
    select
      interest_metrics.*,
      case when interest_metrics.union_count > 0
        then round(interest_metrics.common_count * 100.0 / interest_metrics.union_count)::integer
        else 0
      end as interest_score,
      upcoming_metrics.my_count as upcoming_my_count,
      upcoming_metrics.their_count as upcoming_their_count,
      upcoming_metrics.common_count as upcoming_common_count,
      upcoming_metrics.union_count as upcoming_union_count,
      case when upcoming_metrics.union_count > 0
        then round(upcoming_metrics.common_count * 100.0 / upcoming_metrics.union_count)::integer
        else 0
      end as upcoming_score,
      attended_metrics.my_count as attended_my_count,
      attended_metrics.their_count as attended_their_count,
      attended_metrics.common_count as attended_common_count,
      attended_metrics.union_count as attended_union_count,
      case when attended_metrics.union_count > 0
        then round(attended_metrics.common_count * 100.0 / attended_metrics.union_count)::integer
        else 0
      end as attended_score
    from interest_metrics, upcoming_metrics, attended_metrics
  ),
  result as (
    select *,
      case
        when
          (case when union_count > 0 then 50 else 0 end) +
          (case when upcoming_union_count > 0 then 30 else 0 end) +
          (case when attended_union_count > 0 then 20 else 0 end) = 0
        then 0
        else round(
          (
            interest_score * (case when union_count > 0 then 50 else 0 end) +
            upcoming_score * (case when upcoming_union_count > 0 then 30 else 0 end) +
            attended_score * (case when attended_union_count > 0 then 20 else 0 end)
          )::numeric /
          (
            (case when union_count > 0 then 50 else 0 end) +
            (case when upcoming_union_count > 0 then 30 else 0 end) +
            (case when attended_union_count > 0 then 20 else 0 end)
          )
        )::integer
      end as overall_score
    from scores
  )
  select jsonb_build_object(
    'score', overall_score,
    'calculatedAt', now(),
    'interests', jsonb_build_object(
      'score', interest_score,
      'commonCount', common_count,
      'myCount', my_count,
      'theirCount', their_count,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', item.id, 'label', item.label)
          order by item.label
        )
        from common_interests as item
      ), '[]'::jsonb)
    ),
    'upcoming', jsonb_build_object(
      'score', upcoming_score,
      'commonCount', upcoming_common_count,
      'myCount', upcoming_my_count,
      'theirCount', upcoming_their_count,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'title', item.title,
            'startAt', item.start_at,
            'imageUrl', item.image_url
          ) order by item.start_at
        )
        from common_upcoming as item
      ), '[]'::jsonb)
    ),
    'attended', jsonb_build_object(
      'score', attended_score,
      'commonCount', attended_common_count,
      'myCount', attended_my_count,
      'theirCount', attended_their_count,
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'title', item.title,
            'startAt', item.start_at,
            'imageUrl', item.image_url
          ) order by item.start_at desc
        )
        from common_attended as item
      ), '[]'::jsonb)
    )
  )
  from result;
$$;

create or replace function private.capture_match_compatibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare snapshot jsonb;
begin
  if tg_op = 'INSERT'
    or (
      new.status = 'active'
      and (
        old.status is distinct from 'active'
        or old.accepted_by_user_id is distinct from new.accepted_by_user_id
      )
    ) then
    snapshot := private.calculate_compatibility(new.user1_id, new.user2_id);
    new.matched_at := now();
    new.compatibility_score := coalesce((snapshot ->> 'score')::smallint, 0);
    new.compatibility_snapshot := snapshot;
  end if;
  return new;
end;
$$;

drop trigger if exists capture_match_compatibility on public.matches;
create trigger capture_match_compatibility
before insert or update of status, accepted_by_user_id on public.matches
for each row execute function private.capture_match_compatibility();

update public.matches as match
set
  compatibility_snapshot = private.calculate_compatibility(match.user1_id, match.user2_id),
  compatibility_score = coalesce(
    (private.calculate_compatibility(match.user1_id, match.user2_id) ->> 'score')::smallint,
    0
  ),
  matched_at = coalesce(match.matched_at, match.created_at);

alter table public.matches
  alter column matched_at set default now(),
  alter column matched_at set not null;

create or replace function public.get_candidate_compatibilities(
  target_user_ids uuid[]
)
returns table (
  target_user_id uuid,
  compatibility jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select candidate.id, private.calculate_compatibility(auth.uid(), candidate.id)
  from (
    select distinct requested.id
    from unnest(target_user_ids) as requested(id)
    where requested.id <> auth.uid()
    limit 40
  ) as candidate
  join public.profiles as profile on profile.id = candidate.id
  where auth.uid() is not null
    and profile.account_disabled_at is null
    and not private.is_blocked(auth.uid(), candidate.id);
$$;

create or replace function public.get_match_context(
  target_user_id uuid default null,
  target_match_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  context jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  select jsonb_build_object(
    'matchId', match.id,
    'status', match.status,
    'matchedAt', match.matched_at,
    'compatibility', match.compatibility_snapshot,
    'firstLiker', jsonb_build_object(
      'id', first_liker.id,
      'name', first_liker.full_name
    ),
    'acceptedBy', jsonb_build_object(
      'id', accepter.id,
      'name', accepter.full_name
    ),
    'event', jsonb_build_object(
      'id', event.id,
      'title', event.title,
      'startAt', event.start_at,
      'imageUrl', event.image_url
    )
  ) into context
  from public.matches as match
  join public.events as event on event.id = match.event_id
  left join public.profiles as first_liker
    on first_liker.id = match.first_like_by_user_id
  left join public.profiles as accepter
    on accepter.id = match.accepted_by_user_id
  where current_user_id in (match.user1_id, match.user2_id)
    and match.status <> 'blocked'
    and (target_match_id is null or match.id = target_match_id)
    and (
      target_user_id is null
      or target_user_id = case
        when current_user_id = match.user1_id then match.user2_id
        else match.user1_id
      end
    )
  order by match.matched_at desc
  limit 1;

  return context;
end;
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
  select event.id, event.title, event.start_at, event.venue, event.city,
    event.image_url, event.categories
  from public.event_attendees as attendee
  join public.events as event on event.id = attendee.event_id
  where attendee.user_id = profile_user_id
    and attendee.status = 'joined'
    and (
      (list_kind = 'upcoming' and coalesce(event.end_at, event.start_at) >= now())
      or (list_kind in ('past', 'attended') and coalesce(event.end_at, event.start_at) < now())
    )
  order by
    case when list_kind = 'upcoming' then event.start_at end asc,
    case when list_kind in ('past', 'attended') then event.start_at end desc,
    event.id
  limit least(greatest(page_size, 1), 40)
  offset greatest(page_offset, 0);
$$;

revoke all on function public.get_candidate_compatibilities(uuid[]) from public;
revoke all on function public.get_match_context(uuid, uuid) from public;
grant execute on function public.get_candidate_compatibilities(uuid[]) to authenticated;
grant execute on function public.get_match_context(uuid, uuid) to authenticated;

commit;

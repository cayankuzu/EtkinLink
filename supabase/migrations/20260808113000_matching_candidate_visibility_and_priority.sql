begin;

insert into public.discovery_preferences (user_id)
select profile.id
from public.profiles as profile
on conflict (user_id) do nothing;

insert into public.swipe_quotas (user_id)
select profile.id
from public.profiles as profile
on conflict (user_id) do nothing;

create index if not exists event_likes_incoming_event_idx
  on public.event_likes (event_id, liked_user_id, created_at desc, user_id);

drop function if exists public.get_event_candidates(
  uuid,
  integer,
  timestamptz,
  uuid
);

create function public.get_event_candidates(
  target_event_id uuid,
  page_size integer default 33,
  after_incoming boolean default null,
  after_joined_at timestamptz default null,
  after_user_id uuid default null
)
returns table (
  id uuid,
  full_name text,
  username text,
  age integer,
  gender public.profile_gender,
  bio text,
  city text,
  joined_at timestamptz,
  incoming_like boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      profile.*,
      coalesce(
        preference.gender_preference,
        array['woman', 'man', 'non_binary', 'prefer_not_to_say']::public.profile_gender[]
      ) as gender_preference,
      coalesce(preference.age_min, 18) as age_min,
      coalesce(preference.age_max, 99) as age_max,
      coalesce(preference.required_interest_ids, '{}'::uuid[]) as required_interest_ids
    from public.profiles as profile
    left join public.discovery_preferences as preference
      on preference.user_id = profile.id
    where profile.id = auth.uid()
  ),
  eligible as (
    select
      profile.id,
      coalesce(profile.full_name, 'EtkinLink kullanıcısı') as full_name,
      coalesce(profile.username::text, 'kullanici') as username,
      date_part('year', age(current_date, profile.birth_date))::integer as age,
      profile.gender,
      coalesce(profile.bio, '') as bio,
      coalesce(profile.city, '') as city,
      attendee.joined_at,
      exists (
        select 1
        from public.event_likes as incoming
        where incoming.event_id = target_event_id
          and incoming.user_id = profile.id
          and incoming.liked_user_id = auth.uid()
      ) as incoming_like
    from public.event_attendees as attendee
    join public.profiles as profile on profile.id = attendee.user_id
    left join public.discovery_preferences as target_preference
      on target_preference.user_id = profile.id
    cross join me
    where attendee.event_id = target_event_id
      and attendee.status = 'joined'
      and attendee.matching_enabled
      and profile.matching_enabled
      and me.matching_enabled
      and profile.onboarding_completed
      and profile.id <> auth.uid()
      and private.is_profile_ready(profile.id)
      and profile.gender = any(me.gender_preference)
      and me.gender = any(
        coalesce(
          target_preference.gender_preference,
          array['woman', 'man', 'non_binary', 'prefer_not_to_say']::public.profile_gender[]
        )
      )
      and date_part('year', age(current_date, profile.birth_date))
        between me.age_min and me.age_max
      and date_part('year', age(current_date, me.birth_date))
        between coalesce(target_preference.age_min, 18)
            and coalesce(target_preference.age_max, 99)
      and not private.is_blocked(auth.uid(), profile.id)
      and not exists (
        select 1
        from public.event_likes as outgoing
        where outgoing.event_id = target_event_id
          and outgoing.user_id = auth.uid()
          and outgoing.liked_user_id = profile.id
      )
      and not exists (
        select 1
        from public.event_passes as outgoing_pass
        where outgoing_pass.event_id = target_event_id
          and outgoing_pass.user_id = auth.uid()
          and outgoing_pass.passed_user_id = profile.id
      )
      and not exists (
        select 1
        from public.matches as match
        where match.event_id = target_event_id
          and match.status = 'active'
          and match.user1_id = least(auth.uid(), profile.id)
          and match.user2_id = greatest(auth.uid(), profile.id)
      )
      and (
        cardinality(me.required_interest_ids) = 0
        or not private.is_premium(auth.uid())
        or exists (
          select 1
          from public.user_interests as user_interest
          where user_interest.user_id = profile.id
            and user_interest.interest_id = any(me.required_interest_ids)
        )
      )
  )
  select
    eligible.id,
    eligible.full_name,
    eligible.username,
    eligible.age,
    eligible.gender,
    eligible.bio,
    eligible.city,
    eligible.joined_at,
    eligible.incoming_like
  from eligible
  where after_incoming is null
    or (eligible.incoming_like, eligible.joined_at, eligible.id)
      < (after_incoming, after_joined_at, after_user_id)
  order by
    eligible.incoming_like desc,
    eligible.joined_at desc,
    eligible.id desc
  limit least(greatest(page_size, 1), 40);
$$;

revoke all on function public.get_event_candidates(
  uuid,
  integer,
  boolean,
  timestamptz,
  uuid
) from public;
grant execute on function public.get_event_candidates(
  uuid,
  integer,
  boolean,
  timestamptz,
  uuid
) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_attendees'
  ) then
    alter publication supabase_realtime add table public.event_attendees;
  end if;
end
$$;

commit;

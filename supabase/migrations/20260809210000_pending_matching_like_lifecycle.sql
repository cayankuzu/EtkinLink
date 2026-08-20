begin;

-- A pass in one event must suppress the same person in every event, matching
-- the person-scoped like model and preventing recycled cards.
create or replace function public.get_event_candidates(
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
        where incoming.user_id = profile.id
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
        where outgoing.user_id = auth.uid()
          and outgoing.liked_user_id = profile.id
      )
      and not exists (
        select 1
        from public.event_passes as outgoing_pass
        where outgoing_pass.user_id = auth.uid()
          and outgoing_pass.passed_user_id = profile.id
      )
      and not exists (
        select 1
        from public.matches as active_match
        where active_match.status = 'active'
          and active_match.user1_id = least(auth.uid(), profile.id)
          and active_match.user2_id = greatest(auth.uid(), profile.id)
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

-- Counts describe pending decisions only. Active matches belong exclusively
-- to the match/chat area.
create or replace function public.get_matching_like_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  return jsonb_build_object(
    'outgoingCount', (
      select count(distinct event_like.liked_user_id)
      from public.event_likes as event_like
      join public.profiles as liked_profile
        on liked_profile.id = event_like.liked_user_id
      where event_like.user_id = current_user_id
        and liked_profile.account_disabled_at is null
        and not private.is_blocked(current_user_id, event_like.liked_user_id)
        and not exists (
          select 1
          from public.event_passes as event_pass
          where event_pass.user_id = current_user_id
            and event_pass.passed_user_id = event_like.liked_user_id
        )
        and not exists (
          select 1
          from public.matches as active_match
          where active_match.status = 'active'
            and active_match.user1_id = least(current_user_id, event_like.liked_user_id)
            and active_match.user2_id = greatest(current_user_id, event_like.liked_user_id)
        )
    ),
    'incomingCount', (
      select count(distinct event_like.user_id)
      from public.event_likes as event_like
      join public.profiles as liker_profile
        on liker_profile.id = event_like.user_id
      where event_like.liked_user_id = current_user_id
        and liker_profile.account_disabled_at is null
        and not private.is_blocked(current_user_id, event_like.user_id)
        and not exists (
          select 1
          from public.event_likes as my_like
          where my_like.user_id = current_user_id
            and my_like.liked_user_id = event_like.user_id
        )
        and not exists (
          select 1
          from public.event_passes as my_pass
          where my_pass.user_id = current_user_id
            and my_pass.passed_user_id = event_like.user_id
        )
        and not exists (
          select 1
          from public.matches as active_match
          where active_match.status = 'active'
            and active_match.user1_id = least(current_user_id, event_like.user_id)
            and active_match.user2_id = greatest(current_user_id, event_like.user_id)
        )
    ),
    'incomingLocked', true
  );
end;
$$;

create or replace function public.get_outgoing_event_likes(
  page_size integer default 33,
  after_liked_at timestamptz default null,
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
  event_id uuid,
  event_title text,
  liked_at timestamptz,
  is_matched boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    coalesce(profile.full_name, 'EtkinLink kullanıcısı'),
    coalesce(profile.username::text, 'kullanici'),
    case
      when private.can_view_profile_attribute(profile.id, profile.age_visibility, auth.uid())
        then date_part('year', age(current_date, profile.birth_date))::integer
      else null
    end,
    case
      when private.can_view_profile_attribute(profile.id, profile.gender_visibility, auth.uid())
        then profile.gender
      else null
    end,
    coalesce(profile.bio, ''),
    coalesce(profile.city, ''),
    attendee.joined_at,
    event_like.event_id,
    event.title,
    event_like.created_at,
    false
  from public.event_likes as event_like
  join public.profiles as profile on profile.id = event_like.liked_user_id
  join public.events as event on event.id = event_like.event_id
  left join public.event_attendees as attendee
    on attendee.event_id = event_like.event_id
   and attendee.user_id = profile.id
  where auth.uid() is not null
    and event_like.user_id = auth.uid()
    and profile.account_disabled_at is null
    and not private.is_blocked(auth.uid(), event_like.liked_user_id)
    and not exists (
      select 1
      from public.event_passes as event_pass
      where event_pass.user_id = auth.uid()
        and event_pass.passed_user_id = event_like.liked_user_id
    )
    and not exists (
      select 1
      from public.matches as active_match
      where active_match.status = 'active'
        and active_match.user1_id = least(auth.uid(), event_like.liked_user_id)
        and active_match.user2_id = greatest(auth.uid(), event_like.liked_user_id)
    )
    and (
      after_liked_at is null
      or (event_like.created_at, profile.id) < (after_liked_at, after_user_id)
    )
  order by event_like.created_at desc, profile.id desc
  limit least(greatest(page_size, 1), 33);
$$;

create or replace function public.get_incoming_event_likes(
  page_size integer default 33,
  after_liked_at timestamptz default null,
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
  event_id uuid,
  event_title text,
  liked_at timestamptz,
  is_matched boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest_like as (
    select distinct on (event_like.user_id)
      event_like.user_id,
      event_like.event_id,
      event_like.created_at
    from public.event_likes as event_like
    where event_like.liked_user_id = auth.uid()
      and not private.is_blocked(auth.uid(), event_like.user_id)
      and not exists (
        select 1
        from public.event_likes as my_like
        where my_like.user_id = auth.uid()
          and my_like.liked_user_id = event_like.user_id
      )
      and not exists (
        select 1
        from public.event_passes as my_pass
        where my_pass.user_id = auth.uid()
          and my_pass.passed_user_id = event_like.user_id
      )
      and not exists (
        select 1
        from public.matches as active_match
        where active_match.status = 'active'
          and active_match.user1_id = least(auth.uid(), event_like.user_id)
          and active_match.user2_id = greatest(auth.uid(), event_like.user_id)
      )
    order by event_like.user_id, event_like.created_at desc, event_like.event_id
  )
  select
    profile.id,
    coalesce(profile.full_name, 'EtkinLink kullanıcısı'),
    coalesce(profile.username::text, 'kullanici'),
    case
      when private.can_view_profile_attribute(profile.id, profile.age_visibility, auth.uid())
        then date_part('year', age(current_date, profile.birth_date))::integer
      else null
    end,
    case
      when private.can_view_profile_attribute(profile.id, profile.gender_visibility, auth.uid())
        then profile.gender
      else null
    end,
    coalesce(profile.bio, ''),
    coalesce(profile.city, ''),
    attendee.joined_at,
    latest_like.event_id,
    event.title,
    latest_like.created_at,
    false
  from latest_like
  join public.profiles as profile on profile.id = latest_like.user_id
  join public.events as event on event.id = latest_like.event_id
  left join public.event_attendees as attendee
    on attendee.event_id = latest_like.event_id
   and attendee.user_id = profile.id
  where auth.uid() is not null
    and profile.account_disabled_at is null
    and (
      after_liked_at is null
      or (latest_like.created_at, profile.id) < (after_liked_at, after_user_id)
    )
  order by latest_like.created_at desc, profile.id desc
  limit least(greatest(page_size, 1), 33);
$$;

revoke all on function public.get_event_candidates(uuid, integer, boolean, timestamptz, uuid) from public;
revoke all on function public.get_matching_like_counts() from public;
revoke all on function public.get_outgoing_event_likes(integer, timestamptz, uuid) from public;
revoke all on function public.get_incoming_event_likes(integer, timestamptz, uuid) from public;

grant execute on function public.get_event_candidates(uuid, integer, boolean, timestamptz, uuid) to authenticated;
grant execute on function public.get_matching_like_counts() to authenticated;
grant execute on function public.get_outgoing_event_likes(integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_incoming_event_likes(integer, timestamptz, uuid) to authenticated;

commit;

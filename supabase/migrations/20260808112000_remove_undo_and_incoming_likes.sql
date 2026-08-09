begin;

revoke all on function public.undo_last_event_swipe(uuid, uuid) from public;
drop function if exists public.undo_last_event_swipe(uuid, uuid);

create or replace function private.consume_swipe_quota(
  current_user_id uuid,
  requested_action public.swipe_action
)
returns public.swipe_quotas
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota public.swipe_quotas;
begin
  insert into public.swipe_quotas (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  select * into quota
  from public.swipe_quotas
  where user_id = current_user_id
  for update;

  if quota.window_started_at <= now() - interval '12 hours' then
    update public.swipe_quotas
    set window_started_at = now(),
        used_like_swipes = 0,
        used_pass_swipes = 0,
        reward_like_swipes = 0,
        updated_at = now()
    where user_id = current_user_id
    returning * into quota;
  end if;

  if requested_action = 'like' then
    if quota.used_like_swipes >= 13 + quota.reward_like_swipes then
      raise exception using
        errcode = 'P0001',
        message = 'Beğeni hakkın yenilenene kadar beklemelisin.';
    end if;
    update public.swipe_quotas
    set used_like_swipes = used_like_swipes + 1,
        updated_at = now()
    where user_id = current_user_id
    returning * into quota;
  else
    if quota.used_pass_swipes >= 13 then
      raise exception using
        errcode = 'P0001',
        message = 'Geçme hakkın yenilenene kadar beklemelisin.';
    end if;
    update public.swipe_quotas
    set used_pass_swipes = used_pass_swipes + 1,
        updated_at = now()
    where user_id = current_user_id
    returning * into quota;
  end if;

  return quota;
end;
$$;

create or replace function private.swipe_quota_payload(quota public.swipe_quotas)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'windowStartedAt', quota.window_started_at,
    'resetAt', quota.window_started_at + interval '12 hours',
    'serverNow', now(),
    'likeLimit', 13 + quota.reward_like_swipes,
    'passLimit', 13,
    'usedLikes', quota.used_like_swipes,
    'usedPasses', quota.used_pass_swipes,
    'remainingLikes', greatest(13 + quota.reward_like_swipes - quota.used_like_swipes, 0),
    'remainingPasses', greatest(13 - quota.used_pass_swipes, 0)
  );
$$;

create or replace function public.get_swipe_quota()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  quota public.swipe_quotas;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  insert into public.swipe_quotas (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  select * into quota
  from public.swipe_quotas
  where user_id = current_user_id
  for update;

  if quota.window_started_at <= now() - interval '12 hours' then
    update public.swipe_quotas
    set window_started_at = now(),
        used_like_swipes = 0,
        used_pass_swipes = 0,
        reward_like_swipes = 0,
        updated_at = now()
    where user_id = current_user_id
    returning * into quota;
  end if;

  return private.swipe_quota_payload(quota);
end;
$$;

alter table public.swipe_quotas
  drop constraint if exists swipe_quota_undo_nonnegative;

alter table public.swipe_quotas
  drop column if exists used_undo_swipes;

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
    ),
    'incomingCount', (
      select count(distinct event_like.user_id)
      from public.event_likes as event_like
      join public.profiles as liker_profile
        on liker_profile.id = event_like.user_id
      where event_like.liked_user_id = current_user_id
        and liker_profile.account_disabled_at is null
        and not private.is_blocked(current_user_id, event_like.user_id)
    ),
    'incomingLocked', true
  );
end;
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
    exists (
      select 1
      from public.matches as match
      where match.event_id = latest_like.event_id
        and match.status = 'active'
        and match.user1_id = least(auth.uid(), profile.id)
        and match.user2_id = greatest(auth.uid(), profile.id)
    )
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

revoke all on function public.get_incoming_event_likes(integer, timestamptz, uuid) from public;
grant execute on function public.get_incoming_event_likes(integer, timestamptz, uuid) to authenticated;

commit;

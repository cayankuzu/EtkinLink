begin;

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length
check (bio is null or char_length(btrim(bio)) between 20 and 300);

create or replace function private.is_profile_ready(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = candidate_id
      and p.email_verified
      and p.account_disabled_at is null
      and p.full_name is not null
      and p.username is not null
      and p.birth_date is not null
      and p.gender is not null
      and char_length(btrim(coalesce(p.bio, ''))) between 20 and 300
      and (select count(*) from public.profile_photos pp where pp.user_id = p.id) between 3 and 6
      and (select count(*) from public.user_interests ui where ui.user_id = p.id) between 3 and 12
  );
$$;

create or replace function public.replace_profile_interests(interest_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  distinct_count integer;
  valid_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  select count(distinct selected.id), count(*) filter (where i.is_active)
  into distinct_count, valid_count
  from unnest(coalesce(interest_ids, '{}'::uuid[])) selected(id)
  left join public.interests i on i.id = selected.id;

  if distinct_count not between 3 and 12
     or distinct_count <> cardinality(coalesce(interest_ids, '{}'::uuid[]))
     or valid_count <> distinct_count then
    raise exception using errcode = '23514', message = '3–12 geçerli ve benzersiz ilgi alanı seçmelisin.';
  end if;

  delete from public.user_interests where user_id = current_user_id;
  insert into public.user_interests (user_id, interest_id)
  select current_user_id, selected.id from unnest(interest_ids) selected(id);
end;
$$;

create or replace function private.can_view_profile_attribute(
  owner_user_id uuid,
  attribute_visibility public.visibility_level,
  viewer_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    viewer_user_id = owner_user_id
    or attribute_visibility = 'everyone'
    or (
      attribute_visibility = 'matches'
      and exists (
        select 1
        from public.matches m
        where m.status = 'active'
          and (
            (m.user1_id = owner_user_id and m.user2_id = viewer_user_id)
            or (m.user2_id = owner_user_id and m.user1_id = viewer_user_id)
          )
      )
    );
$$;

create or replace function public.get_my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.profiles p
  where auth.uid() is not null and p.id = auth.uid();
$$;

create or replace function public.get_profile_view(target_profile_id uuid)
returns table (
  id uuid,
  full_name text,
  username text,
  birth_date date,
  age integer,
  gender public.profile_gender,
  gender_visibility public.visibility_level,
  age_visibility public.visibility_level,
  bio text,
  city text,
  email_verified boolean,
  onboarding_completed boolean,
  matching_enabled boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.username::text,
    case when p.id = auth.uid() then p.birth_date else null end,
    case
      when private.can_view_profile_attribute(p.id, p.age_visibility, auth.uid())
        then date_part('year', age(current_date, p.birth_date))::integer
      else null
    end,
    case
      when private.can_view_profile_attribute(p.id, p.gender_visibility, auth.uid())
        then p.gender
      else null
    end,
    case when p.id = auth.uid() then p.gender_visibility else null end,
    case when p.id = auth.uid() then p.age_visibility else null end,
    p.bio,
    p.city,
    case when p.id = auth.uid() then p.email_verified else false end,
    p.onboarding_completed,
    case when p.id = auth.uid() then p.matching_enabled else false end,
    p.created_at
  from public.profiles p
  where auth.uid() is not null
    and p.id = target_profile_id
    and p.account_disabled_at is null
    and (p.id = auth.uid() or p.onboarding_completed)
    and (
      not private.is_blocked(auth.uid(), p.id)
      or exists (
        select 1 from public.matches m
        where (m.user1_id = auth.uid() and m.user2_id = p.id)
           or (m.user2_id = auth.uid() and m.user1_id = p.id)
      )
    );
$$;

drop function if exists public.get_event_candidates(uuid, integer, timestamptz, uuid);
create function public.get_event_candidates(
  target_event_id uuid,
  page_size integer default 20,
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
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.*, dp.gender_preference, dp.age_min, dp.age_max, dp.required_interest_ids
    from public.profiles p
    join public.discovery_preferences dp on dp.user_id = p.id
    where p.id = auth.uid()
  )
  select
    p.id,
    p.full_name,
    p.username::text,
    case
      when private.can_view_profile_attribute(p.id, p.age_visibility, auth.uid())
        then date_part('year', age(current_date, p.birth_date))::integer
      else null
    end,
    case
      when private.can_view_profile_attribute(p.id, p.gender_visibility, auth.uid())
        then p.gender
      else null
    end,
    p.bio,
    p.city,
    ea.joined_at
  from public.event_attendees ea
  join public.profiles p on p.id = ea.user_id
  join public.discovery_preferences target_pref on target_pref.user_id = p.id
  cross join me
  where ea.event_id = target_event_id
    and ea.status = 'joined'
    and ea.matching_enabled
    and p.matching_enabled
    and p.onboarding_completed
    and p.id <> auth.uid()
    and private.is_profile_ready(p.id)
    and p.gender = any(me.gender_preference)
    and me.gender = any(target_pref.gender_preference)
    and date_part('year', age(current_date, p.birth_date)) between me.age_min and me.age_max
    and date_part('year', age(current_date, me.birth_date)) between target_pref.age_min and target_pref.age_max
    and not private.is_blocked(auth.uid(), p.id)
    and not exists (
      select 1 from public.event_likes l
      where l.event_id = target_event_id and l.user_id = auth.uid() and l.liked_user_id = p.id
    )
    and not exists (
      select 1 from public.event_passes ps
      where ps.event_id = target_event_id and ps.user_id = auth.uid() and ps.passed_user_id = p.id
    )
    and not exists (
      select 1 from public.matches m
      where m.event_id = target_event_id and m.status = 'active'
        and ((m.user1_id = auth.uid() and m.user2_id = p.id) or (m.user1_id = p.id and m.user2_id = auth.uid()))
    )
    and (
      cardinality(me.required_interest_ids) = 0
      or not private.is_premium(auth.uid())
      or exists (
        select 1 from public.user_interests ui
        where ui.user_id = p.id and ui.interest_id = any(me.required_interest_ids)
      )
    )
    and (
      after_joined_at is null
      or (ea.joined_at, ea.user_id) < (after_joined_at, after_user_id)
    )
  order by ea.joined_at desc, ea.user_id desc
  limit least(greatest(page_size, 1), 40);
$$;

drop function if exists public.list_matches(text, integer, timestamptz, uuid);
create function public.list_matches(
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
  other_age integer,
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
security definer
set search_path = ''
as $$
  select
    m.id,
    m.event_id,
    e.title,
    other.id,
    other.full_name,
    other.username::text,
    case
      when private.can_view_profile_attribute(other.id, other.age_visibility, auth.uid())
        then date_part('year', age(current_date, other.birth_date))::integer
      else null
    end,
    case
      when private.can_view_profile_attribute(other.id, other.gender_visibility, auth.uid())
        then other.gender
      else null
    end,
    other.bio,
    other.city,
    photo.storage_path,
    m.status,
    m.created_at,
    summary.last_message,
    summary.last_message_at,
    case when auth.uid() = m.user1_id then coalesce(summary.unread_user1, 0) else coalesce(summary.unread_user2, 0) end,
    coalesce(summary.last_message_at, m.created_at)
  from public.matches m
  join public.events e on e.id = m.event_id
  join public.profiles other on other.id = case when auth.uid() = m.user1_id then m.user2_id else m.user1_id end
  left join public.profile_photos photo on photo.user_id = other.id and photo.position = 0
  left join public.chat_pair_summaries summary on summary.match_id = m.id
  where auth.uid() is not null
    and auth.uid() in (m.user1_id, m.user2_id)
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

drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read on public.profiles for select to authenticated
using (
  account_disabled_at is null
  and (onboarding_completed or id = auth.uid())
  and (id = auth.uid() or not private.is_blocked(auth.uid(), id))
);

drop policy if exists attendees_read on public.event_attendees;
create policy attendees_read on public.event_attendees for select to authenticated
using (
  user_id = auth.uid()
  or (status = 'joined' and not private.is_blocked(auth.uid(), user_id))
);

drop policy if exists photos_authenticated_read on public.profile_photos;
create policy photos_authenticated_read on public.profile_photos for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = profile_photos.user_id
      and p.account_disabled_at is null
      and p.onboarding_completed
      and not private.is_blocked(auth.uid(), p.id)
  )
);

drop policy if exists user_interests_read on public.user_interests;
create policy user_interests_read on public.user_interests for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = user_interests.user_id
      and p.account_disabled_at is null
      and p.onboarding_completed
      and not private.is_blocked(auth.uid(), p.id)
  )
);

revoke select on public.profiles from authenticated;
grant select (id, full_name, username, bio, city, created_at) on public.profiles to authenticated;
revoke insert, update, delete on public.profile_photos from authenticated;
revoke insert, delete on public.user_interests from authenticated;

update storage.buckets set public = false where id = 'profile-photos';

drop policy if exists profile_photo_storage_update on storage.objects;
create policy profile_photo_storage_update on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_photo_storage_delete on storage.objects;
create policy profile_photo_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists profile_photo_storage_select on storage.objects;
create policy profile_photo_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and exists (
    select 1 from public.profile_photos pp
    join public.profiles p on p.id = pp.user_id
    where pp.storage_path = name
      and (
        pp.user_id = auth.uid()
        or (
          p.account_disabled_at is null
          and p.onboarding_completed
          and not private.is_blocked(auth.uid(), p.id)
        )
      )
  )
);

revoke all on function public.get_my_profile() from public;
revoke all on function public.get_profile_view(uuid) from public;
revoke all on function public.replace_profile_interests(uuid[]) from public;
revoke all on function public.get_event_candidates(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.list_matches(text, integer, timestamptz, uuid) from public;

grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.get_profile_view(uuid) to authenticated;
grant execute on function public.replace_profile_interests(uuid[]) to authenticated;
grant execute on function public.get_event_candidates(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_matches(text, integer, timestamptz, uuid) to authenticated;

commit;

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists unaccent with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.profile_gender as enum ('woman', 'man', 'non_binary', 'prefer_not_to_say');
create type public.visibility_level as enum ('everyone', 'matches', 'hidden');
create type public.attendance_status as enum ('joined', 'left');
create type public.match_status as enum ('active', 'ended', 'blocked');
create type public.swipe_action as enum ('like', 'pass');
create type public.notification_kind as enum (
  'new_like', 'new_match', 'direct_message', 'room_message',
  'match_ended', 'blocked', 'unblocked', 'event_reminder', 'system'
);
create type public.delivery_status as enum ('pending', 'processing', 'sent', 'failed', 'cancelled');
create type public.report_reason as enum (
  'fake_profile', 'harassment', 'spam', 'nudity', 'underage', 'hate_speech', 'other'
);
create type public.report_status as enum ('pending', 'reviewing', 'resolved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  username extensions.citext unique,
  birth_date date,
  gender public.profile_gender,
  gender_visibility public.visibility_level not null default 'matches',
  age_visibility public.visibility_level not null default 'matches',
  bio text,
  city text,
  email_verified boolean not null default false,
  onboarding_completed boolean not null default false,
  matching_enabled boolean not null default true,
  account_disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(btrim(full_name)) between 2 and 70),
  constraint profiles_username_format check (username is null or username::text ~ '^[a-z0-9_]{3,24}$'),
  constraint profiles_bio_length check (bio is null or char_length(btrim(bio)) between 1 and 300),
  constraint profiles_city_length check (city is null or char_length(btrim(city)) between 2 and 40)
);

create table public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  position smallint not null,
  created_at timestamptz not null default now(),
  unique (user_id, position),
  unique (user_id, storage_path),
  constraint profile_photos_position check (position between 0 and 5),
  constraint profile_photos_storage_path check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$')
);

create table public.interests (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null unique,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint interests_slug check (slug ~ '^[a-z0-9-]{2,40}$'),
  constraint interests_label check (char_length(btrim(label)) between 2 and 40)
);

create table public.user_interests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);

create table public.cities (
  plate_code smallint primary key,
  name text not null unique,
  search_name text not null,
  constraint cities_plate_code check (plate_code between 1 and 81)
);

create table public.discovery_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gender_preference public.profile_gender[] not null default array['woman','man','non_binary','prefer_not_to_say']::public.profile_gender[],
  age_min smallint not null default 18,
  age_max smallint not null default 99,
  required_interest_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_age_range check (age_min between 18 and 99 and age_max between 18 and 99 and age_min <= age_max),
  constraint discovery_gender_not_empty check (cardinality(gender_preference) > 0)
);

create table public.entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  tier text not null default 'free',
  active_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_tier check (tier in ('free', 'premium'))
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  external_id bigint unique,
  source_guid text not null unique,
  source_url text not null,
  title text not null,
  summary text,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  venue text,
  city text,
  district text,
  address text,
  image_url text,
  categories text[] not null default '{}',
  source_updated_at timestamptz,
  is_cancelled boolean not null default false,
  raw_source jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title_length check (char_length(btrim(title)) between 2 and 180),
  constraint events_end_after_start check (end_at is null or end_at >= start_at),
  constraint events_source_url_https check (source_url ~ '^https://'),
  constraint events_image_url_https check (image_url is null or image_url ~ '^https://')
);

create table public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.attendance_status not null default 'joined',
  matching_enabled boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.saved_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create table public.swipe_quotas (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  used_like_swipes smallint not null default 0,
  used_pass_swipes smallint not null default 0,
  reward_like_swipes smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint swipe_quota_nonnegative check (used_like_swipes >= 0 and used_pass_swipes >= 0 and reward_like_swipes >= 0)
);

create table public.event_likes (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  liked_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, liked_user_id),
  constraint event_likes_no_self check (user_id <> liked_user_id)
);

create table public.event_passes (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  passed_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, passed_user_id),
  constraint event_passes_no_self check (user_id <> passed_user_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid not null references public.profiles(id) on delete cascade,
  status public.match_status not null default 'active',
  first_like_by_user_id uuid references public.profiles(id) on delete set null,
  accepted_by_user_id uuid references public.profiles(id) on delete set null,
  user1_chat_deleted_at timestamptz,
  user2_chat_deleted_at timestamptz,
  user1_chat_cleared_at timestamptz,
  user2_chat_cleared_at timestamptz,
  ended_at timestamptz,
  ended_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user1_id, user2_id),
  constraint matches_canonical_pair check (user1_id < user2_id),
  constraint matches_no_self check (user1_id <> user2_id)
);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  client_message_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sender_id, client_message_id),
  constraint direct_messages_no_self check (sender_id <> receiver_id),
  constraint direct_messages_body_length check (char_length(btrim(body)) between 1 and 700)
);

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_id, client_message_id),
  constraint room_messages_body_length check (char_length(btrim(body)) between 1 and 700)
);

create table public.chat_settings (
  match_id uuid not null references public.matches(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  read_receipts_enabled boolean not null default true,
  online_status_enabled boolean not null default true,
  typing_indicator_enabled boolean not null default true,
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, owner_user_id)
);

create table public.chat_pair_summaries (
  match_id uuid primary key references public.matches(id) on delete cascade,
  last_message_id uuid references public.direct_messages(id) on delete set null,
  last_message text,
  last_message_at timestamptz,
  unread_user1 integer not null default 0,
  unread_user2 integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint chat_pair_unread_nonnegative check (unread_user1 >= 0 and unread_user2 >= 0)
);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  kind public.notification_kind not null,
  route_kind text,
  route_id uuid,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  delivery_status public.delivery_status not null default 'pending',
  attempt_count smallint not null default 0,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  constraint notification_title_length check (char_length(title) between 1 and 100),
  constraint notification_body_length check (char_length(body) between 1 and 240)
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  encrypted_token text not null,
  platform text not null,
  device_id_hash text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_platform check (platform in ('android', 'ios'))
);

create table public.moderation_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  reason public.report_reason not null,
  details text not null,
  context_snapshot jsonb not null default '{}'::jsonb,
  client_context jsonb not null default '{}'::jsonb,
  status public.report_status not null default 'pending',
  created_at timestamptz not null default now(),
  constraint moderation_no_self check (reporter_user_id <> target_user_id),
  constraint moderation_details_length check (char_length(btrim(details)) between 20 and 1500)
);

create table private.idempotency_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  operation text not null,
  request_id uuid not null,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation, request_id)
);

create index events_discovery_idx on public.events (is_cancelled, start_at, id);
create index events_city_date_idx on public.events (city, start_at, id);
create index events_categories_gin_idx on public.events using gin (categories);
create index event_attendees_user_idx on public.event_attendees (user_id, status, joined_at desc);
create index event_attendees_event_idx on public.event_attendees (event_id, status, joined_at desc);
create index event_likes_reverse_idx on public.event_likes (event_id, liked_user_id, user_id);
create index event_passes_user_idx on public.event_passes (event_id, user_id, created_at desc);
create index matches_user1_idx on public.matches (user1_id, status, updated_at desc);
create index matches_user2_idx on public.matches (user2_id, status, updated_at desc);
create index direct_messages_thread_idx on public.direct_messages (match_id, created_at desc, id desc);
create index direct_messages_unread_idx on public.direct_messages (receiver_id, read_at, created_at desc) where read_at is null;
create index room_messages_thread_idx on public.room_messages (event_id, created_at desc, id desc);
create index notification_events_user_idx on public.notification_events (user_id, read_at, created_at desc);
create index notification_outbox_idx on public.notification_events (delivery_status, next_attempt_at, created_at) where delivery_status in ('pending', 'failed');
create index moderation_reports_rate_idx on public.moderation_reports (reporter_user_id, created_at desc);
create index idempotency_expiry_idx on private.idempotency_records (created_at);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.validate_adult_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.birth_date is not null and new.birth_date > (current_date - interval '18 years')::date then
    raise exception using errcode = '23514', message = 'EtkinLink yalnızca 18 yaş ve üzeri kullanıcılar içindir.';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_adult before insert or update of birth_date on public.profiles
for each row execute function private.validate_adult_profile();

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger discovery_preferences_set_updated_at before update on public.discovery_preferences
for each row execute function private.set_updated_at();
create trigger entitlements_set_updated_at before update on public.entitlements
for each row execute function private.set_updated_at();
create trigger events_set_updated_at before update on public.events
for each row execute function private.set_updated_at();
create trigger event_attendees_set_updated_at before update on public.event_attendees
for each row execute function private.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
for each row execute function private.set_updated_at();
create trigger chat_settings_set_updated_at before update on public.chat_settings
for each row execute function private.set_updated_at();

create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email_verified)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    new.email_confirmed_at is not null
  )
  on conflict (id) do update set
    email_verified = excluded.email_verified,
    updated_at = now();

  insert into public.discovery_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.entitlements (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.swipe_quotas (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_or_verified
after insert or update of email_confirmed_at on auth.users
for each row execute function private.handle_auth_user_change();

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
      and char_length(btrim(coalesce(p.bio, ''))) > 0
      and (select count(*) from public.profile_photos pp where pp.user_id = p.id) between 3 and 6
      and exists (select 1 from public.user_interests ui where ui.user_id = p.id)
  );
$$;

create or replace function private.is_premium(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
    where e.user_id = candidate_id
      and e.tier = 'premium'
      and (e.active_until is null or e.active_until > now())
  );
$$;

create or replace function private.is_blocked(first_user uuid, second_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = first_user and b.blocked_id = second_user)
       or (b.blocker_id = second_user and b.blocked_id = first_user)
  );
$$;

create or replace function public.is_event_room_open(target_event_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = target_event_id
      and not e.is_cancelled
      and now() >= e.start_at - interval '13 days'
      and now() <= coalesce(e.end_at, e.start_at) + interval '3 days'
  );
$$;

create or replace function public.complete_onboarding()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result public.profiles;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if not private.is_profile_ready(current_user_id) then
    raise exception using errcode = '23514', message = 'Profil için ad, kullanıcı adı, doğum tarihi, cinsiyet, biyografi, en az 3 fotoğraf ve en az 1 ilgi alanı gerekir.';
  end if;
  update public.profiles set onboarding_completed = true where id = current_user_id returning * into result;
  return result;
end;
$$;

create or replace function public.join_event(target_event_id uuid)
returns public.event_attendees
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  global_matching boolean;
  result public.event_attendees;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if not private.is_profile_ready(current_user_id)
    or not exists (select 1 from public.profiles p where p.id = current_user_id and p.onboarding_completed) then
    raise exception using errcode = '23514', message = 'Katılmadan önce profilini tamamlamalısın.';
  end if;
  if not exists (select 1 from public.events e where e.id = target_event_id and not e.is_cancelled) then
    raise exception using errcode = 'P0002', message = 'Etkinlik bulunamadı.';
  end if;
  select matching_enabled into global_matching from public.profiles where id = current_user_id;
  insert into public.event_attendees (event_id, user_id, status, matching_enabled, joined_at, left_at)
  values (target_event_id, current_user_id, 'joined', global_matching, now(), null)
  on conflict (event_id, user_id) do update set
    status = 'joined', matching_enabled = global_matching, joined_at = now(), left_at = null, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.leave_event(target_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  update public.event_attendees
  set status = 'left', left_at = now(), matching_enabled = false, updated_at = now()
  where event_id = target_event_id and user_id = current_user_id;
end;
$$;

create or replace function public.set_matching_enabled(enabled boolean, target_event_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if target_event_id is not null and not private.is_premium(current_user_id) then
    raise exception using errcode = '42501', message = 'Odaya özel eşleşme ayarı Premium ile yakında açılacak.';
  end if;
  if target_event_id is null then
    update public.profiles set matching_enabled = enabled where id = current_user_id;
    update public.event_attendees set matching_enabled = enabled, updated_at = now()
    where user_id = current_user_id and status = 'joined';
  else
    update public.event_attendees set matching_enabled = enabled, updated_at = now()
    where user_id = current_user_id and event_id = target_event_id and status = 'joined';
  end if;
end;
$$;

create or replace function public.get_event_candidates(
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
  select p.id, p.full_name, p.username::text,
    date_part('year', age(current_date, p.birth_date))::integer as age,
    p.gender, p.bio, p.city, ea.joined_at
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
    and not exists (select 1 from public.event_likes l where l.event_id = target_event_id and l.user_id = auth.uid() and l.liked_user_id = p.id)
    and not exists (select 1 from public.event_passes ps where ps.event_id = target_event_id and ps.user_id = auth.uid() and ps.passed_user_id = p.id)
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

create or replace function private.consume_swipe_quota(current_user_id uuid, requested_action public.swipe_action)
returns public.swipe_quotas
language plpgsql
security definer
set search_path = ''
as $$
declare quota public.swipe_quotas;
begin
  insert into public.swipe_quotas (user_id) values (current_user_id)
  on conflict (user_id) do nothing;
  select * into quota from public.swipe_quotas where user_id = current_user_id for update;
  if quota.window_started_at <= now() - interval '12 hours' then
    update public.swipe_quotas set
      window_started_at = now(), used_like_swipes = 0, used_pass_swipes = 0, reward_like_swipes = 0, updated_at = now()
    where user_id = current_user_id returning * into quota;
  end if;
  if requested_action = 'like' then
    if quota.used_like_swipes >= 13 + quota.reward_like_swipes then
      raise exception using errcode = 'P0001', message = 'Beğeni hakkın yenilenene kadar beklemelisin.';
    end if;
    update public.swipe_quotas set used_like_swipes = used_like_swipes + 1, updated_at = now()
    where user_id = current_user_id returning * into quota;
  else
    if quota.used_pass_swipes >= 13 then
      raise exception using errcode = 'P0001', message = 'Geçme hakkın yenilenene kadar beklemelisin.';
    end if;
    update public.swipe_quotas set used_pass_swipes = used_pass_swipes + 1, updated_at = now()
    where user_id = current_user_id returning * into quota;
  end if;
  return quota;
end;
$$;

create or replace function public.swipe_event_candidate(
  target_event_id uuid,
  target_user_id uuid,
  action public.swipe_action,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  canonical_user1 uuid;
  canonical_user2 uuid;
  request_hash text;
  previous private.idempotency_records;
  quota public.swipe_quotas;
  reverse_like boolean;
  new_match public.matches;
  result jsonb;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if current_user_id = target_user_id then raise exception using errcode = '23514', message = 'Kendini değerlendiremezsin.'; end if;
  request_hash := encode(extensions.digest(target_event_id::text || ':' || target_user_id::text || ':' || action::text, 'sha256'), 'hex');
  select i.* into previous from private.idempotency_records i
  where i.user_id = current_user_id and i.operation = 'swipe_event_candidate' and i.request_id = $4;
  if found then
    if previous.payload_hash <> request_hash then raise exception using errcode = '22023', message = 'Aynı istek kimliği farklı veriyle kullanılamaz.'; end if;
    return previous.response;
  end if;
  if private.is_blocked(current_user_id, target_user_id) then raise exception using errcode = '42501', message = 'Bu kullanıcıyla etkileşim kuramazsın.'; end if;
  if not exists (
    select 1 from public.event_attendees a
    where a.event_id = target_event_id and a.user_id = current_user_id and a.status = 'joined' and a.matching_enabled
  ) or not exists (
    select 1 from public.event_attendees a
    where a.event_id = target_event_id and a.user_id = target_user_id and a.status = 'joined' and a.matching_enabled
  ) then raise exception using errcode = '42501', message = 'Eşleşme yalnızca aynı etkinliğin aktif katılımcıları arasında kullanılabilir.';
  end if;
  if not private.is_profile_ready(current_user_id) or not private.is_profile_ready(target_user_id)
    or not exists (select 1 from public.profiles p where p.id = current_user_id and p.onboarding_completed)
    or not exists (select 1 from public.profiles p where p.id = target_user_id and p.onboarding_completed) then
    raise exception using errcode = '23514', message = 'Her iki profil de eşleşmeye hazır olmalı.';
  end if;
  canonical_user1 := least(current_user_id, target_user_id);
  canonical_user2 := greatest(current_user_id, target_user_id);
  perform pg_advisory_xact_lock(hashtextextended(target_event_id::text || canonical_user1::text || canonical_user2::text, 0));

  if action = 'like' and exists (
    select 1 from public.event_likes where event_id = target_event_id and user_id = current_user_id and liked_user_id = target_user_id
  ) then
    result := jsonb_build_object('status', 'liked', 'duplicate', true);
  elsif action = 'pass' and exists (
    select 1 from public.event_passes where event_id = target_event_id and user_id = current_user_id and passed_user_id = target_user_id
  ) then
    result := jsonb_build_object('status', 'passed', 'duplicate', true);
  else
    quota := private.consume_swipe_quota(current_user_id, action);
    if action = 'pass' then
      insert into public.event_passes (event_id, user_id, passed_user_id)
      values (target_event_id, current_user_id, target_user_id);
      result := jsonb_build_object('status', 'passed', 'matched', false, 'quota', to_jsonb(quota));
    else
      insert into public.event_likes (event_id, user_id, liked_user_id)
      values (target_event_id, current_user_id, target_user_id);
      select exists (
        select 1 from public.event_likes
        where event_id = target_event_id and user_id = target_user_id and liked_user_id = current_user_id
      ) into reverse_like;
      if reverse_like then
        insert into public.matches (
          event_id, user1_id, user2_id, status, first_like_by_user_id, accepted_by_user_id,
          ended_at, ended_by_user_id, user1_chat_deleted_at, user2_chat_deleted_at,
          user1_chat_cleared_at, user2_chat_cleared_at
        ) values (
          target_event_id, canonical_user1, canonical_user2, 'active', target_user_id, current_user_id,
          null, null, null, null, now(), now()
        )
        on conflict (event_id, user1_id, user2_id) do update set
          status = 'active', accepted_by_user_id = current_user_id, ended_at = null, ended_by_user_id = null,
          user1_chat_deleted_at = null, user2_chat_deleted_at = null,
          user1_chat_cleared_at = now(), user2_chat_cleared_at = now(), updated_at = now()
        returning * into new_match;
        insert into public.chat_settings (match_id, owner_user_id) values
          (new_match.id, canonical_user1), (new_match.id, canonical_user2)
        on conflict do nothing;
        insert into public.chat_pair_summaries (match_id) values (new_match.id) on conflict do nothing;
        update public.swipe_quotas set reward_like_swipes = least(reward_like_swipes + 1, 13), updated_at = now()
        where user_id in (canonical_user1, canonical_user2);
        insert into public.notification_events (user_id, actor_user_id, kind, route_kind, route_id, title, body)
        values
          (target_user_id, current_user_id, 'new_match', 'match', new_match.id, 'Yeni bir eşleşmen var', 'Aynı etkinlikte karşılıklı olarak birbirinizi beğendiniz.'),
          (current_user_id, target_user_id, 'new_match', 'match', new_match.id, 'Eşleştiniz!', 'Sohbet artık ikiniz için de açık.');
        result := jsonb_build_object('status', 'matched', 'matched', true, 'match_id', new_match.id, 'quota', to_jsonb(quota));
      else
        insert into public.notification_events (user_id, actor_user_id, kind, route_kind, route_id, title, body)
        values (target_user_id, current_user_id, 'new_like', 'event', target_event_id, 'Yeni bir beğeni aldın', 'Katıldığın bir etkinlikten yeni bir beğenin var.');
        result := jsonb_build_object('status', 'liked', 'matched', false, 'quota', to_jsonb(quota));
      end if;
    end if;
  end if;
  insert into private.idempotency_records (user_id, operation, request_id, payload_hash, response)
  values (current_user_id, 'swipe_event_candidate', request_id, request_hash, result);
  return result;
end;
$$;

create or replace function private.update_chat_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_match public.matches;
begin
  select * into target_match from public.matches where id = new.match_id;
  insert into public.chat_pair_summaries (
    match_id, last_message_id, last_message, last_message_at, unread_user1, unread_user2, updated_at
  ) values (
    new.match_id, new.id, new.body, new.created_at,
    case when new.receiver_id = target_match.user1_id then 1 else 0 end,
    case when new.receiver_id = target_match.user2_id then 1 else 0 end,
    now()
  ) on conflict (match_id) do update set
    last_message_id = excluded.last_message_id,
    last_message = excluded.last_message,
    last_message_at = excluded.last_message_at,
    unread_user1 = public.chat_pair_summaries.unread_user1 + excluded.unread_user1,
    unread_user2 = public.chat_pair_summaries.unread_user2 + excluded.unread_user2,
    updated_at = now();
  return new;
end;
$$;

create trigger direct_message_summary after insert on public.direct_messages
for each row execute function private.update_chat_summary();

create or replace function public.send_direct_message(
  target_match_id uuid,
  message_body text,
  client_message_id uuid
)
returns public.direct_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_match public.matches;
  target_receiver uuid;
  result public.direct_messages;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  select * into target_match from public.matches where id = target_match_id for update;
  if not found or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;
  if target_match.status <> 'active' or target_match.ended_at is not null or private.is_blocked(target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = '42501', message = 'Bu sohbet artık mesaj kabul etmiyor.';
  end if;
  if (current_user_id = target_match.user1_id and target_match.user1_chat_deleted_at is not null)
    or (current_user_id = target_match.user2_id and target_match.user2_chat_deleted_at is not null) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;
  target_receiver := case when current_user_id = target_match.user1_id then target_match.user2_id else target_match.user1_id end;
  insert into public.direct_messages (match_id, sender_id, receiver_id, body, client_message_id)
  values (target_match_id, current_user_id, target_receiver, btrim(message_body), client_message_id)
  on conflict (sender_id, client_message_id) do update set body = public.direct_messages.body
  returning * into result;
  if exists (
    select 1 from public.chat_settings s
    where s.match_id = target_match_id and s.owner_user_id = target_receiver and s.notifications_enabled
  ) then
    insert into public.notification_events (user_id, actor_user_id, kind, route_kind, route_id, title, body)
    values (target_receiver, current_user_id, 'direct_message', 'match', target_match_id, 'Yeni mesaj', left(result.body, 120));
  end if;
  return result;
end;
$$;

create or replace function public.send_room_message(
  target_event_id uuid,
  message_body text,
  client_message_id uuid
)
returns public.room_messages
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); result public.room_messages;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if not public.is_event_room_open(target_event_id) then
    raise exception using errcode = '42501', message = 'Bu etkinliğin sohbet dönemi kapalı.';
  end if;
  if not exists (
    select 1 from public.event_attendees a
    where a.event_id = target_event_id and a.user_id = current_user_id and a.status = 'joined'
  ) then raise exception using errcode = '42501', message = 'Odaya yalnızca etkinlik katılımcıları yazabilir.';
  end if;
  insert into public.room_messages (event_id, sender_id, body, client_message_id)
  values (target_event_id, current_user_id, btrim(message_body), client_message_id)
  on conflict (sender_id, client_message_id) do update set body = public.room_messages.body
  returning * into result;
  return result;
end;
$$;

create or replace function public.mark_match_read(target_match_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); changed integer; target_match public.matches;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  select * into target_match from public.matches where id = target_match_id;
  if not found or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;
  update public.direct_messages set read_at = now()
  where match_id = target_match_id and receiver_id = current_user_id and read_at is null;
  get diagnostics changed = row_count;
  update public.chat_pair_summaries set
    unread_user1 = case when current_user_id = target_match.user1_id then 0 else unread_user1 end,
    unread_user2 = case when current_user_id = target_match.user2_id then 0 else unread_user2 end,
    updated_at = now()
  where match_id = target_match_id;
  return changed;
end;
$$;

create or replace function public.end_match(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); target_match public.matches; other_user uuid;
begin
  select * into target_match from public.matches where id = target_match_id for update;
  if current_user_id is null or not found or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Eşleşme bulunamadı.';
  end if;
  other_user := case when current_user_id = target_match.user1_id then target_match.user2_id else target_match.user1_id end;
  update public.matches set status = 'ended', ended_at = now(), ended_by_user_id = current_user_id, updated_at = now()
  where id = target_match_id;
  delete from public.event_likes where event_id = target_match.event_id
    and ((user_id = target_match.user1_id and liked_user_id = target_match.user2_id)
      or (user_id = target_match.user2_id and liked_user_id = target_match.user1_id));
  insert into public.notification_events (user_id, actor_user_id, kind, route_kind, route_id, title, body)
  values (other_user, current_user_id, 'match_ended', 'match', target_match_id, 'Eşleşme sona erdi', 'Bu eşleşmede artık yeni mesaj gönderilemez.');
end;
$$;

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if current_user_id = target_user_id then raise exception using errcode = '23514', message = 'Kendini engelleyemezsin.'; end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (current_user_id, target_user_id) on conflict do nothing;
  delete from public.event_likes where (user_id = current_user_id and liked_user_id = target_user_id)
    or (user_id = target_user_id and liked_user_id = current_user_id);
  update public.matches set status = 'blocked', updated_at = now()
  where (user1_id = least(current_user_id, target_user_id) and user2_id = greatest(current_user_id, target_user_id));
  insert into public.notification_events (user_id, actor_user_id, kind, title, body)
  values (target_user_id, current_user_id, 'blocked', 'Bir kullanıcı seni engelledi', 'Karşılıklı keşif ve mesajlaşma erişimi kapatıldı.');
end;
$$;

create or replace function public.unblock_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  delete from public.user_blocks where blocker_id = current_user_id and blocked_id = target_user_id;
  update public.matches m set status = 'ended', ended_at = coalesce(m.ended_at, now()), updated_at = now()
  where m.user1_id = least(current_user_id, target_user_id) and m.user2_id = greatest(current_user_id, target_user_id)
    and not private.is_blocked(current_user_id, target_user_id) and m.status = 'blocked';
  insert into public.notification_events (user_id, actor_user_id, kind, title, body)
  values (target_user_id, current_user_id, 'unblocked', 'Engel kaldırıldı', 'Önceki eşleşme otomatik olarak yeniden açılmadı.');
end;
$$;

create or replace function public.delete_match_chat(target_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); target_match public.matches;
begin
  select * into target_match from public.matches where id = target_match_id for update;
  if current_user_id is null or not found or current_user_id not in (target_match.user1_id, target_match.user2_id) then
    raise exception using errcode = 'P0002', message = 'Sohbet bulunamadı.';
  end if;
  if current_user_id = target_match.user1_id then
    update public.matches set user1_chat_deleted_at = now(), updated_at = now() where id = target_match_id;
    target_match.user1_chat_deleted_at := now();
  else
    update public.matches set user2_chat_deleted_at = now(), updated_at = now() where id = target_match_id;
    target_match.user2_chat_deleted_at := now();
  end if;
  if target_match.user1_chat_deleted_at is not null and target_match.user2_chat_deleted_at is not null then
    delete from public.matches where id = target_match_id;
  end if;
end;
$$;

create or replace function public.submit_report(
  target_user_id uuid,
  reason public.report_reason,
  details text,
  target_event_id uuid default null,
  target_match_id uuid default null,
  client_context jsonb default '{}'::jsonb,
  block_after boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); report_id uuid; snapshot jsonb;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if (select count(*) from public.moderation_reports r where r.reporter_user_id = current_user_id and r.created_at > now() - interval '1 hour') >= 5 then
    raise exception using errcode = 'P0001', message = 'Çok fazla bildirim gönderdin. Lütfen daha sonra tekrar dene.';
  end if;
  select jsonb_build_object(
    'event_id', m.event_id, 'match_status', m.status, 'match_created_at', m.created_at
  ) into snapshot from public.matches m
  where m.id = target_match_id and current_user_id in (m.user1_id, m.user2_id) and target_user_id in (m.user1_id, m.user2_id);
  insert into public.moderation_reports (
    reporter_user_id, target_user_id, event_id, match_id, reason, details, context_snapshot, client_context
  ) values (
    current_user_id, target_user_id, target_event_id, target_match_id, reason, btrim(details), coalesce(snapshot, '{}'::jsonb), client_context
  ) returning id into report_id;
  if block_after then perform public.block_user(target_user_id); end if;
  return report_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.profile_photos enable row level security;
alter table public.interests enable row level security;
alter table public.user_interests enable row level security;
alter table public.cities enable row level security;
alter table public.discovery_preferences enable row level security;
alter table public.entitlements enable row level security;
alter table public.events enable row level security;
alter table public.event_attendees enable row level security;
alter table public.saved_events enable row level security;
alter table public.user_blocks enable row level security;
alter table public.swipe_quotas enable row level security;
alter table public.event_likes enable row level security;
alter table public.event_passes enable row level security;
alter table public.matches enable row level security;
alter table public.direct_messages enable row level security;
alter table public.room_messages enable row level security;
alter table public.chat_settings enable row level security;
alter table public.chat_pair_summaries enable row level security;
alter table public.notification_events enable row level security;
alter table public.push_tokens enable row level security;
alter table public.moderation_reports enable row level security;

create policy profiles_authenticated_read on public.profiles for select to authenticated
using (account_disabled_at is null and (onboarding_completed or id = auth.uid()));
create policy profiles_owner_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());
create policy photos_authenticated_read on public.profile_photos for select to authenticated using (true);
create policy photos_owner_insert on public.profile_photos for insert to authenticated with check (user_id = auth.uid());
create policy photos_owner_update on public.profile_photos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy photos_owner_delete on public.profile_photos for delete to authenticated using (user_id = auth.uid());
create policy interests_read on public.interests for select to authenticated using (is_active);
create policy user_interests_read on public.user_interests for select to authenticated using (true);
create policy user_interests_owner_insert on public.user_interests for insert to authenticated with check (user_id = auth.uid());
create policy user_interests_owner_delete on public.user_interests for delete to authenticated using (user_id = auth.uid());
create policy cities_read on public.cities for select to authenticated using (true);
create policy preferences_owner_read on public.discovery_preferences for select to authenticated using (user_id = auth.uid());
create policy preferences_owner_update on public.discovery_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entitlements_owner_read on public.entitlements for select to authenticated using (user_id = auth.uid());
create policy events_read on public.events for select to authenticated using (true);
create policy attendees_read on public.event_attendees for select to authenticated using (status = 'joined' or user_id = auth.uid());
create policy saved_events_owner_all on public.saved_events for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy blocks_owner_read on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
create policy quota_owner_read on public.swipe_quotas for select to authenticated using (user_id = auth.uid());
create policy likes_owner_read on public.event_likes for select to authenticated using (user_id = auth.uid());
create policy passes_owner_read on public.event_passes for select to authenticated using (user_id = auth.uid());
create policy matches_party_read on public.matches for select to authenticated using (
  (user1_id = auth.uid() and user1_chat_deleted_at is null) or (user2_id = auth.uid() and user2_chat_deleted_at is null)
);
create policy direct_messages_party_read on public.direct_messages for select to authenticated using (
  exists (
    select 1 from public.matches m where m.id = match_id
      and ((m.user1_id = auth.uid() and m.user1_chat_deleted_at is null and direct_messages.created_at > coalesce(m.user1_chat_cleared_at, '-infinity'::timestamptz))
        or (m.user2_id = auth.uid() and m.user2_chat_deleted_at is null and direct_messages.created_at > coalesce(m.user2_chat_cleared_at, '-infinity'::timestamptz)))
  )
);
create policy room_messages_attendee_read on public.room_messages for select to authenticated using (
  exists (select 1 from public.event_attendees a where a.event_id = room_messages.event_id and a.user_id = auth.uid())
  and not private.is_blocked(auth.uid(), sender_id)
);
create policy chat_settings_owner_read on public.chat_settings for select to authenticated using (
  owner_user_id = auth.uid() or exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.user1_id, m.user2_id))
);
create policy chat_settings_owner_update on public.chat_settings for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy chat_summaries_party_read on public.chat_pair_summaries for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and auth.uid() in (m.user1_id, m.user2_id))
);
create policy notifications_owner_read on public.notification_events for select to authenticated using (user_id = auth.uid());
create policy notifications_owner_update on public.notification_events for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_tokens_owner_read on public.push_tokens for select to authenticated using (user_id = auth.uid());
create policy reports_owner_read on public.moderation_reports for select to authenticated using (reporter_user_id = auth.uid());

grant usage on schema public to authenticated;
grant select on public.profiles, public.profile_photos, public.interests, public.user_interests, public.cities,
  public.discovery_preferences, public.entitlements, public.events, public.event_attendees, public.saved_events,
  public.user_blocks, public.swipe_quotas, public.event_likes, public.event_passes, public.matches,
  public.direct_messages, public.room_messages, public.chat_settings, public.chat_pair_summaries,
  public.notification_events, public.push_tokens, public.moderation_reports to authenticated;
grant update (full_name, username, birth_date, gender, gender_visibility, age_visibility, bio, city) on public.profiles to authenticated;
grant insert, update, delete on public.profile_photos to authenticated;
grant insert, delete on public.user_interests to authenticated;
grant update (gender_preference, age_min, age_max, required_interest_ids) on public.discovery_preferences to authenticated;
grant insert, delete on public.saved_events to authenticated;
grant update (read_receipts_enabled, online_status_enabled, typing_indicator_enabled, notifications_enabled) on public.chat_settings to authenticated;
grant update (read_at) on public.notification_events to authenticated;

revoke all on function public.complete_onboarding() from public;
revoke all on function public.join_event(uuid) from public;
revoke all on function public.leave_event(uuid) from public;
revoke all on function public.set_matching_enabled(boolean, uuid) from public;
revoke all on function public.get_event_candidates(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.swipe_event_candidate(uuid, uuid, public.swipe_action, uuid) from public;
revoke all on function public.send_direct_message(uuid, text, uuid) from public;
revoke all on function public.send_room_message(uuid, text, uuid) from public;
revoke all on function public.mark_match_read(uuid) from public;
revoke all on function public.end_match(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.delete_match_chat(uuid) from public;
revoke all on function public.submit_report(uuid, public.report_reason, text, uuid, uuid, jsonb, boolean) from public;

grant execute on function public.is_event_room_open(uuid) to authenticated;
grant execute on function public.complete_onboarding() to authenticated;
grant execute on function public.join_event(uuid) to authenticated;
grant execute on function public.leave_event(uuid) to authenticated;
grant execute on function public.set_matching_enabled(boolean, uuid) to authenticated;
grant execute on function public.get_event_candidates(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.swipe_event_candidate(uuid, uuid, public.swipe_action, uuid) to authenticated;
grant execute on function public.send_direct_message(uuid, text, uuid) to authenticated;
grant execute on function public.send_room_message(uuid, text, uuid) to authenticated;
grant execute on function public.mark_match_read(uuid) to authenticated;
grant execute on function public.end_match(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.delete_match_chat(uuid) to authenticated;
grant execute on function public.submit_report(uuid, public.report_reason, text, uuid, uuid, jsonb, boolean) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos', 'profile-photos', true, 8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy profile_photo_storage_insert on storage.objects for insert to authenticated
with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy profile_photo_storage_update on storage.objects for update to authenticated
using (bucket_id = 'profile-photos' and owner_id = auth.uid()::text)
with check (bucket_id = 'profile-photos' and owner_id = auth.uid()::text);
create policy profile_photo_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'profile-photos' and owner_id = auth.uid()::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages'
  ) then alter publication supabase_realtime add table public.direct_messages; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_messages'
  ) then alter publication supabase_realtime add table public.room_messages; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then alter publication supabase_realtime add table public.matches; end if;
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_events'
  ) then alter publication supabase_realtime add table public.notification_events; end if;
end $$;

commit;

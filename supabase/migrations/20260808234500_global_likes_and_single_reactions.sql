begin;

-- A like represents interest in a person, not in one copy of their card.
-- Preserve the most relevant historical row before enforcing that rule.
with ranked_likes as (
  select
    event_like.event_id,
    event_like.user_id,
    event_like.liked_user_id,
    row_number() over (
      partition by event_like.user_id, event_like.liked_user_id
      order by
        exists (
          select 1
          from public.matches as match
          where match.event_id = event_like.event_id
            and match.status = 'active'
            and match.user1_id = least(event_like.user_id, event_like.liked_user_id)
            and match.user2_id = greatest(event_like.user_id, event_like.liked_user_id)
        ) desc,
        event_like.created_at desc,
        event_like.event_id desc
    ) as reaction_rank
  from public.event_likes as event_like
)
delete from public.event_likes as event_like
using ranked_likes as ranked
where ranked.reaction_rank > 1
  and event_like.event_id = ranked.event_id
  and event_like.user_id = ranked.user_id
  and event_like.liked_user_id = ranked.liked_user_id;

create unique index if not exists event_likes_global_reaction_idx
  on public.event_likes (user_id, liked_user_id);

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
        where outgoing_pass.event_id = target_event_id
          and outgoing_pass.user_id = auth.uid()
          and outgoing_pass.passed_user_id = profile.id
      )
      and not exists (
        select 1
        from public.matches as match
        where match.status = 'active'
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
  existing_match public.matches;
  new_match public.matches;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if current_user_id = target_user_id then
    raise exception using errcode = '23514', message = 'Kendini değerlendiremezsin.';
  end if;

  request_hash := encode(
    extensions.digest(
      target_event_id::text || ':' || target_user_id::text || ':' || action::text,
      'sha256'
    ),
    'hex'
  );
  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'swipe_event_candidate'
    and record.request_id = $4;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı istek kimliği farklı veriyle kullanılamaz.';
    end if;
    return previous.response;
  end if;

  if private.is_blocked(current_user_id, target_user_id) then
    raise exception using errcode = '42501', message = 'Bu kullanıcıyla etkileşim kuramazsın.';
  end if;
  if not exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = current_user_id
      and attendee.status = 'joined'
      and attendee.matching_enabled
  ) or not exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = target_user_id
      and attendee.status = 'joined'
      and attendee.matching_enabled
  ) then
    raise exception using
      errcode = '42501',
      message = 'Eşleşme yalnızca aynı etkinliğin aktif katılımcıları arasında kullanılabilir.';
  end if;
  if not private.is_profile_ready(current_user_id)
    or not private.is_profile_ready(target_user_id)
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = current_user_id and profile.onboarding_completed
    )
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = target_user_id and profile.onboarding_completed
    ) then
    raise exception using
      errcode = '23514',
      message = 'Her iki profil de eşleşmeye hazır olmalı.';
  end if;

  canonical_user1 := least(current_user_id, target_user_id);
  canonical_user2 := greatest(current_user_id, target_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(canonical_user1::text || canonical_user2::text, 0)
  );

  select match.* into existing_match
  from public.matches as match
  where match.status = 'active'
    and match.user1_id = canonical_user1
    and match.user2_id = canonical_user2
  order by match.updated_at desc, match.id desc
  limit 1;

  if found then
    result := jsonb_build_object(
      'status', 'matched',
      'matched', true,
      'match_id', existing_match.id,
      'duplicate', true
    );
  elsif exists (
    select 1
    from public.event_likes
    where user_id = current_user_id
      and liked_user_id = target_user_id
  ) then
    result := jsonb_build_object(
      'status', 'liked', 'matched', false, 'duplicate', true
    );
  elsif exists (
    select 1
    from public.event_passes
    where event_id = target_event_id
      and user_id = current_user_id
      and passed_user_id = target_user_id
  ) then
    result := jsonb_build_object(
      'status', 'passed', 'matched', false, 'duplicate', true
    );
  else
    quota := private.consume_swipe_quota(current_user_id, action);
    if action = 'pass' then
      insert into public.event_passes (event_id, user_id, passed_user_id)
      values (target_event_id, current_user_id, target_user_id);
      result := jsonb_build_object(
        'status', 'passed', 'matched', false, 'quota', to_jsonb(quota)
      );
    else
      insert into public.event_likes (event_id, user_id, liked_user_id)
      values (target_event_id, current_user_id, target_user_id);

      select exists (
        select 1
        from public.event_likes
        where user_id = target_user_id
          and liked_user_id = current_user_id
      ) into reverse_like;

      if reverse_like then
        insert into public.matches (
          event_id,
          user1_id,
          user2_id,
          status,
          first_like_by_user_id,
          accepted_by_user_id,
          ended_at,
          ended_by_user_id,
          user1_chat_deleted_at,
          user2_chat_deleted_at,
          user1_chat_cleared_at,
          user2_chat_cleared_at
        ) values (
          target_event_id,
          canonical_user1,
          canonical_user2,
          'active',
          target_user_id,
          current_user_id,
          null,
          null,
          null,
          null,
          now(),
          now()
        )
        on conflict (event_id, user1_id, user2_id) do update set
          status = 'active',
          accepted_by_user_id = current_user_id,
          ended_at = null,
          ended_by_user_id = null,
          user1_chat_deleted_at = null,
          user2_chat_deleted_at = null,
          user1_chat_cleared_at = now(),
          user2_chat_cleared_at = now(),
          updated_at = now()
        returning * into new_match;

        insert into public.chat_settings (match_id, owner_user_id)
        values
          (new_match.id, canonical_user1),
          (new_match.id, canonical_user2)
        on conflict do nothing;
        insert into public.chat_pair_summaries (match_id)
        values (new_match.id)
        on conflict do nothing;
        update public.swipe_quotas
        set reward_like_swipes = least(reward_like_swipes + 1, 13),
            updated_at = now()
        where user_id in (canonical_user1, canonical_user2);
        result := jsonb_build_object(
          'status', 'matched',
          'matched', true,
          'match_id', new_match.id,
          'quota', to_jsonb(quota)
        );
      else
        result := jsonb_build_object(
          'status', 'liked', 'matched', false, 'quota', to_jsonb(quota)
        );
      end if;
    end if;
  end if;

  insert into private.idempotency_records (
    user_id,
    operation,
    request_id,
    payload_hash,
    response
  ) values (
    current_user_id,
    'swipe_event_candidate',
    request_id,
    request_hash,
    result
  );
  return result;
end;
$$;

create or replace function private.capture_match_compatibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  first_liker_id uuid;
begin
  if tg_op = 'INSERT'
    or (
      new.status = 'active'
      and (
        old.status is distinct from 'active'
        or old.accepted_by_user_id is distinct from new.accepted_by_user_id
      )
    ) then
    select event_like.user_id into first_liker_id
    from public.event_likes as event_like
    where (
      (event_like.user_id = new.user1_id and event_like.liked_user_id = new.user2_id)
      or
      (event_like.user_id = new.user2_id and event_like.liked_user_id = new.user1_id)
    )
    order by event_like.created_at, event_like.user_id
    limit 1;

    new.first_like_by_user_id := coalesce(first_liker_id, new.first_like_by_user_id);
    snapshot := private.calculate_compatibility(new.user1_id, new.user2_id);
    new.matched_at := now();
    new.compatibility_score := coalesce((snapshot ->> 'score')::smallint, 0);
    new.compatibility_snapshot := snapshot;
  end if;
  return new;
end;
$$;

create or replace function public.change_event_like_to_pass(
  target_event_id uuid,
  target_user_id uuid,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_id uuid := request_id;
  request_hash text;
  previous private.idempotency_records;
  quota public.swipe_quotas;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  request_hash := encode(
    extensions.digest(target_event_id::text || ':' || target_user_id::text, 'sha256'),
    'hex'
  );
  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'change_event_like_to_pass'
    and record.request_id = requested_id;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı işlem anahtarı farklı veriyle kullanılamaz.';
    end if;
    return previous.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, target_user_id)::text || greatest(current_user_id, target_user_id)::text,
      0
    )
  );

  if not exists (
    select 1
    from public.event_likes
    where event_id = target_event_id
      and user_id = current_user_id
      and liked_user_id = target_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Beğeni bulunamadı.';
  end if;
  if exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and match.user1_id = least(current_user_id, target_user_id)
      and match.user2_id = greatest(current_user_id, target_user_id)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Aktif eşleşmeyi Mesajlar alanından yönetebilirsin.';
  end if;

  quota := private.consume_swipe_quota(current_user_id, 'pass');
  delete from public.event_likes
  where event_id = target_event_id
    and user_id = current_user_id
    and liked_user_id = target_user_id;
  insert into public.event_passes (event_id, user_id, passed_user_id)
  values (target_event_id, current_user_id, target_user_id)
  on conflict do nothing;

  result := jsonb_build_object(
    'status', 'passed',
    'quota', private.swipe_quota_payload(quota)
  );
  insert into private.idempotency_records (
    user_id, operation, request_id, payload_hash, response
  ) values (
    current_user_id,
    'change_event_like_to_pass',
    requested_id,
    request_hash,
    result
  );
  return result;
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
    exists (
      select 1
      from public.matches as match
      where match.status = 'active'
        and match.user1_id = least(auth.uid(), profile.id)
        and match.user2_id = greatest(auth.uid(), profile.id)
    )
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
    and (
      after_liked_at is null
      or (event_like.created_at, profile.id) < (after_liked_at, after_user_id)
    )
  order by event_like.created_at desc, profile.id desc
  limit least(greatest(page_size, 1), 33);
$$;

commit;

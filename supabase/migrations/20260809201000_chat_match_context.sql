begin;

create or replace function public.get_chat_match_context(target_match_id uuid)
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
  match_status public.match_status,
  match_created_at timestamptz,
  last_message text,
  last_message_at timestamptz,
  blocked_by_me boolean,
  photo_ids uuid[],
  photo_storage_paths text[],
  photo_positions integer[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    match.id,
    match.event_id,
    event.title,
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
    match.status,
    match.created_at,
    summary.last_message,
    summary.last_message_at,
    exists (
      select 1
      from public.user_blocks as own_block
      where own_block.blocker_id = auth.uid()
        and own_block.blocked_id = other.id
    ),
    coalesce(photos.ids, '{}'::uuid[]),
    coalesce(photos.paths, '{}'::text[]),
    coalesce(photos.positions, '{}'::integer[])
  from public.matches as match
  join public.events as event on event.id = match.event_id
  join public.profiles as other
    on other.id = case
      when auth.uid() = match.user1_id then match.user2_id
      else match.user1_id
    end
  left join public.chat_pair_summaries as summary on summary.match_id = match.id
  left join lateral (
    select
      array_agg(photo.id order by photo.position, photo.id) as ids,
      array_agg(photo.storage_path order by photo.position, photo.id) as paths,
      array_agg(photo.position order by photo.position, photo.id) as positions
    from public.profile_photos as photo
    where photo.user_id = other.id
  ) as photos on true
  where auth.uid() is not null
    and match.id = target_match_id
    and auth.uid() in (match.user1_id, match.user2_id)
    and (
      (auth.uid() = match.user1_id and match.user1_chat_deleted_at is null)
      or (auth.uid() = match.user2_id and match.user2_chat_deleted_at is null)
    )
  limit 1;
$$;

revoke all on function public.get_chat_match_context(uuid) from public;
grant execute on function public.get_chat_match_context(uuid) to authenticated;

commit;

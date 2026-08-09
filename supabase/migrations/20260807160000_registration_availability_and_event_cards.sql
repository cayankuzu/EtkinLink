begin;

create or replace function public.is_email_available(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with candidate as (
    select lower(btrim(coalesce(candidate_email, ''))) as value
  )
  select
    candidate.value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and char_length(candidate.value) <= 254
    and not exists (
      select 1
      from auth.users account
      where lower(account.email) = candidate.value
    )
  from candidate;
$$;

revoke all on function public.is_email_available(text) from public;
grant execute on function public.is_email_available(text) to anon, authenticated;

create or replace function public.get_event_card_states(target_external_ids bigint[])
returns table (
  database_id uuid,
  external_id bigint,
  attendee_count bigint,
  joined boolean,
  saved boolean,
  attendee_photo_paths text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    event.id,
    event.external_id,
    (
      select count(*)
      from public.event_attendees attendee
      where attendee.event_id = event.id
        and attendee.status = 'joined'
    ) as attendee_count,
    exists (
      select 1
      from public.event_attendees attendee
      where attendee.event_id = event.id
        and attendee.user_id = auth.uid()
        and attendee.status = 'joined'
    ) as joined,
    exists (
      select 1
      from public.saved_events saved_event
      where saved_event.event_id = event.id
        and saved_event.user_id = auth.uid()
    ) as saved,
    array(
      select photo.storage_path
      from public.event_attendees attendee
      join public.profiles profile on profile.id = attendee.user_id
      join public.profile_photos photo
        on photo.user_id = attendee.user_id
       and photo.position = 0
      where attendee.event_id = event.id
        and attendee.status = 'joined'
        and profile.account_disabled_at is null
        and profile.onboarding_completed
        and not private.is_blocked(auth.uid(), attendee.user_id)
      order by attendee.joined_at desc, attendee.user_id
      limit 3
    ) as attendee_photo_paths
  from public.events event
  where auth.uid() is not null
    and event.external_id = any(coalesce(target_external_ids, '{}'::bigint[]))
  order by event.external_id;
$$;

revoke all on function public.get_event_card_states(bigint[]) from public;
grant execute on function public.get_event_card_states(bigint[]) to authenticated;

commit;

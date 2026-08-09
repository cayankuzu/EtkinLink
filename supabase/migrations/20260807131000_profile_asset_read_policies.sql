begin;

create or replace function private.can_view_profile_assets(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = candidate_id
        and profile.account_disabled_at is null
        and (profile.id = auth.uid() or profile.onboarding_completed)
        and (
          profile.id = auth.uid()
          or not private.is_blocked(auth.uid(), profile.id)
        )
    );
$$;

drop policy if exists photos_authenticated_read on public.profile_photos;
create policy photos_authenticated_read
on public.profile_photos
for select
to authenticated
using (private.can_view_profile_assets(user_id));

drop policy if exists user_interests_read on public.user_interests;
create policy user_interests_read
on public.user_interests
for select
to authenticated
using (private.can_view_profile_assets(user_id));

drop policy if exists profile_photo_storage_select on storage.objects;
create policy profile_photo_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and exists (
    select 1
    from public.profile_photos as photo
    where photo.storage_path = name
      and private.can_view_profile_assets(photo.user_id)
  )
);

commit;

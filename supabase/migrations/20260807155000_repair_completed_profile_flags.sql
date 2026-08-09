begin;

update public.profiles p
set onboarding_completed = true,
    updated_at = now()
where not p.onboarding_completed
  and p.email_verified
  and p.account_disabled_at is null
  and p.full_name is not null
  and p.username is not null
  and p.birth_date is not null
  and p.gender is not null
  and char_length(btrim(coalesce(p.bio, ''))) > 0
  and (
    select count(*)
    from public.profile_photos pp
    where pp.user_id = p.id
  ) between 3 and 6
  and exists (
    select 1
    from public.user_interests ui
    where ui.user_id = p.id
  );

commit;

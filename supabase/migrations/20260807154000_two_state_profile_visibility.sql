begin;

update public.profiles
set gender_visibility = 'hidden'
where gender_visibility = 'matches';

update public.profiles
set age_visibility = 'hidden'
where age_visibility = 'matches';

alter table public.profiles
  alter column gender_visibility set default 'hidden',
  alter column age_visibility set default 'hidden';

alter table public.profiles
  add constraint profiles_gender_visibility_two_state
    check (gender_visibility in ('everyone', 'hidden')),
  add constraint profiles_age_visibility_two_state
    check (age_visibility in ('everyone', 'hidden'));

commit;

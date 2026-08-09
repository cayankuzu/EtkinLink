begin;

alter table public.profiles
  validate constraint profiles_username_format;

commit;

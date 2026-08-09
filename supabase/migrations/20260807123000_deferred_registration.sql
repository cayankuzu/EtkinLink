begin;

create or replace function public.get_registration_interests()
returns table (
  id uuid,
  slug text,
  label text,
  sort_order smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.slug, i.label, i.sort_order
  from public.interests i
  where i.is_active
  order by i.sort_order, i.label;
$$;

revoke all on function public.get_registration_interests() from public;
grant execute on function public.get_registration_interests() to anon, authenticated;

create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (
    id,
    full_name,
    username,
    birth_date,
    gender,
    bio,
    city,
    email_verified
  )
  values (
    new.id,
    nullif(btrim(coalesce(metadata ->> 'full_name', '')), ''),
    nullif(lower(btrim(coalesce(metadata ->> 'username', ''))), '')::extensions.citext,
    nullif(metadata ->> 'birth_date', '')::date,
    nullif(metadata ->> 'gender', '')::public.profile_gender,
    nullif(btrim(coalesce(metadata ->> 'bio', '')), ''),
    nullif(btrim(coalesce(metadata ->> 'city', '')), ''),
    new.email_confirmed_at is not null
  )
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    username = coalesce(public.profiles.username, excluded.username),
    birth_date = coalesce(public.profiles.birth_date, excluded.birth_date),
    gender = coalesce(public.profiles.gender, excluded.gender),
    bio = coalesce(public.profiles.bio, excluded.bio),
    city = coalesce(public.profiles.city, excluded.city),
    email_verified = excluded.email_verified,
    updated_at = now();

  insert into public.discovery_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.entitlements (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.swipe_quotas (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.user_interests (user_id, interest_id)
  select new.id, i.id
  from public.interests i
  where i.is_active
    and i.id::text in (
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(metadata -> 'interest_ids') = 'array'
            then metadata -> 'interest_ids'
          else '[]'::jsonb
        end
      )
    )
  on conflict do nothing;

  return new;
end;
$$;

commit;

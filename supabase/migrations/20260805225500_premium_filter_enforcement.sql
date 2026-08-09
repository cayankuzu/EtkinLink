begin;

revoke update on public.discovery_preferences from authenticated;

create or replace function public.set_match_filters(
  genders public.profile_gender[],
  minimum_age smallint,
  maximum_age smallint,
  interest_ids uuid[] default '{}'
)
returns public.discovery_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid(); result public.discovery_preferences;
begin
  if current_user_id is null then raise exception using errcode = '28000', message = 'Oturum gerekli.'; end if;
  if not private.is_premium(current_user_id) then
    raise exception using errcode = '42501', message = 'Gelişmiş eşleşme filtreleri Premium ile yakında açılacak.';
  end if;
  if cardinality(genders) = 0 or minimum_age < 18 or maximum_age > 99 or minimum_age > maximum_age then
    raise exception using errcode = '23514', message = 'Filtre değerleri geçersiz.';
  end if;
  insert into public.discovery_preferences (user_id, gender_preference, age_min, age_max, required_interest_ids)
  values (current_user_id, genders, minimum_age, maximum_age, coalesce(interest_ids, '{}'))
  on conflict (user_id) do update set
    gender_preference = excluded.gender_preference,
    age_min = excluded.age_min,
    age_max = excluded.age_max,
    required_interest_ids = excluded.required_interest_ids,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.set_match_filters(public.profile_gender[], smallint, smallint, uuid[]) from public;
grant execute on function public.set_match_filters(public.profile_gender[], smallint, smallint, uuid[]) to authenticated;

commit;

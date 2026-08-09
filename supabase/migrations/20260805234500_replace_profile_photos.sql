create or replace function public.replace_profile_photos(storage_paths text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  previous_paths text[];
  item text;
  item_index integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if cardinality(storage_paths) not between 3 and 6 then
    raise exception using errcode = '23514', message = 'En az 3, en fazla 6 fotoğraf gerekir.';
  end if;
  if cardinality(storage_paths) <> cardinality(array(select distinct unnest(storage_paths))) then
    raise exception using errcode = '23505', message = 'Aynı fotoğraf birden fazla kullanılamaz.';
  end if;
  foreach item in array storage_paths loop
    if item !~ ('^' || current_user_id::text || '/[0-9a-f-]+\.(jpg|png|webp|heic|heif)$') then
      raise exception using errcode = '42501', message = 'Geçersiz fotoğraf yolu.';
    end if;
  end loop;

  select coalesce(array_agg(storage_path order by position), '{}'::text[]) into previous_paths
  from public.profile_photos where user_id = current_user_id;

  delete from public.profile_photos where user_id = current_user_id;
  for item_index in 1..cardinality(storage_paths) loop
    insert into public.profile_photos (user_id, storage_path, position)
    values (current_user_id, storage_paths[item_index], item_index - 1);
  end loop;
  return previous_paths;
end;
$$;

revoke all on function public.replace_profile_photos(text[]) from public;
grant execute on function public.replace_profile_photos(text[]) to authenticated;

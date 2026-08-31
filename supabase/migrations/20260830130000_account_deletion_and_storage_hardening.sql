begin;

create table private.account_deletion_requests (
  user_id uuid not null,
  client_request_id uuid not null,
  phase text not null default 'requested',
  recent_login_verified_at timestamptz not null default clock_timestamp(),
  auth_deleted_at timestamptz,
  storage_deleting_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, client_request_id),
  unique (client_request_id),
  constraint account_deletion_requests_phase_check
    check (phase in ('requested', 'auth_deleted', 'storage_deleting', 'completed')),
  constraint account_deletion_requests_attempt_count_check
    check (attempt_count >= 0),
  constraint account_deletion_requests_error_code_check
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
);

alter table private.account_deletion_requests enable row level security;
alter table private.account_deletion_requests force row level security;

create index account_deletion_requests_active_user_idx
on private.account_deletion_requests (user_id, updated_at desc)
where phase <> 'completed';

revoke all on table private.account_deletion_requests
from public, anon, authenticated, service_role;

create or replace function private.profile_photo_path_is_owned(
  object_name text,
  candidate_user_id uuid
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    candidate_user_id is not null
    and object_name ~ (
      '^' || candidate_user_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      || '\.(jpg|jpeg|png|webp|heic|heif)$'
    )
    and pg_catalog.cardinality(storage.foldername(object_name)) = 1;
$$;

create or replace function private.profile_photo_path_has_owner_prefix(
  object_name text,
  candidate_user_id uuid
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    candidate_user_id is not null
    and pg_catalog.strpos(object_name, '/') =
      char_length(candidate_user_id::text) + 1
    and pg_catalog.lower(pg_catalog.split_part(object_name, '/', 1)) =
      candidate_user_id::text
    and char_length(object_name) > char_length(candidate_user_id::text) + 1;
$$;

create or replace function private.profile_photo_uploads_are_allowed(
  candidate_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from private.account_deletion_requests as request
    where request.user_id = candidate_user_id
  );
$$;

create or replace function private.profile_photo_upload_is_allowed(
  object_name text,
  object_metadata jsonb,
  candidate_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.profile_photo_path_is_owned(object_name, candidate_user_id)
    and case pg_catalog.lower(storage.extension(object_name))
      when 'jpg' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/jpeg'
      when 'jpeg' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/jpeg'
      when 'png' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/png'
      when 'webp' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/webp'
      when 'heic' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/heic'
      when 'heif' then pg_catalog.lower(coalesce(object_metadata ->> 'mimetype', '')) = 'image/heif'
      else false
    end
    and case
      when coalesce(object_metadata ->> 'size', '') ~ '^[0-9]{1,10}$'
        then (object_metadata ->> 'size')::bigint between 1 and 6291456
      else false
    end
    and private.profile_photo_uploads_are_allowed(candidate_user_id);
$$;

update storage.buckets
set
  public = false,
  file_size_limit = 6291456,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]::text[]
where id = 'profile-photos';

drop policy if exists profile_photo_storage_insert on storage.objects;
create policy profile_photo_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and private.profile_photo_upload_is_allowed(name, metadata, auth.uid())
);

drop policy if exists profile_photo_storage_update on storage.objects;
create policy profile_photo_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.profile_photo_path_is_owned(name, auth.uid())
  and private.profile_photo_uploads_are_allowed(auth.uid())
)
with check (
  bucket_id = 'profile-photos'
  and private.profile_photo_upload_is_allowed(name, metadata, auth.uid())
);

drop policy if exists profile_photo_storage_select on storage.objects;
create policy profile_photo_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (
    exists (
      select 1
      from public.profile_photos as photo
      where photo.storage_path = name
        and private.can_view_profile_assets(photo.user_id)
    )
    or private.profile_photo_path_has_owner_prefix(name, auth.uid())
  )
);

drop policy if exists profile_photo_storage_delete on storage.objects;
create policy profile_photo_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and private.profile_photo_path_has_owner_prefix(name, auth.uid())
);

create or replace function public.get_account_deletion_request(
  target_client_request_id uuid
)
returns table (
  user_id uuid,
  client_request_id uuid,
  phase text,
  recent_login_verified_at timestamptz,
  attempt_count integer,
  last_error_code text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.user_id,
    request.client_request_id,
    request.phase,
    request.recent_login_verified_at,
    request.attempt_count,
    request.last_error_code,
    request.updated_at
  from private.account_deletion_requests as request
  where request.client_request_id = target_client_request_id;
$$;

-- PostgREST validates the bearer signature and expiry before invoking this
-- SECURITY INVOKER function. Unlike auth.users lookups, this remains usable
-- for a short-lived retry after the Auth row has already been deleted.
create or replace function public.get_verified_account_deletion_claims()
returns table (
  user_id uuid,
  issued_at bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    auth.uid(),
    (auth.jwt() ->> 'iat')::bigint
  where current_user = 'authenticated'
    and auth.uid() is not null
    and coalesce(auth.jwt() ->> 'iat', '') ~ '^[0-9]{1,16}$';
$$;

create or replace function public.begin_account_deletion_request(
  target_user_id uuid,
  target_client_request_id uuid
)
returns table (
  user_id uuid,
  client_request_id uuid,
  phase text,
  recent_login_verified_at timestamptz,
  attempt_count integer,
  last_error_code text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.account_deletion_requests (
    user_id,
    client_request_id
  )
  values (
    target_user_id,
    target_client_request_id
  )
  on conflict on constraint account_deletion_requests_client_request_id_key
  do nothing;

  return query
  select
    request.user_id,
    request.client_request_id,
    request.phase,
    request.recent_login_verified_at,
    request.attempt_count,
    request.last_error_code,
    request.updated_at
  from private.account_deletion_requests as request
  where request.client_request_id = target_client_request_id;
end;
$$;

create or replace function public.advance_account_deletion_request(
  target_user_id uuid,
  target_client_request_id uuid,
  expected_phase text,
  next_phase text,
  error_code text default null
)
returns table (
  user_id uuid,
  client_request_id uuid,
  phase text,
  recent_login_verified_at timestamptz,
  attempt_count integer,
  last_error_code text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    (expected_phase = 'requested' and next_phase in ('requested', 'auth_deleted'))
    or (expected_phase = 'auth_deleted' and next_phase = 'storage_deleting')
    or (expected_phase = 'storage_deleting' and next_phase in ('storage_deleting', 'completed'))
  ) then
    raise exception using
      errcode = '22023',
      message = 'ACCOUNT_DELETION_INVALID_TRANSITION';
  end if;

  if error_code is not null and error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using
      errcode = '22023',
      message = 'ACCOUNT_DELETION_INVALID_ERROR_CODE';
  end if;

  return query
  update private.account_deletion_requests as request
  set
    phase = next_phase,
    auth_deleted_at = case
      when next_phase = 'auth_deleted'
        then coalesce(request.auth_deleted_at, clock_timestamp())
      else request.auth_deleted_at
    end,
    storage_deleting_at = case
      when next_phase = 'storage_deleting'
        then coalesce(request.storage_deleting_at, clock_timestamp())
      else request.storage_deleting_at
    end,
    completed_at = case
      when next_phase = 'completed'
        then coalesce(request.completed_at, clock_timestamp())
      else request.completed_at
    end,
    attempt_count = request.attempt_count + 1,
    last_error_code = error_code,
    last_error_at = case
      when error_code is null then null
      else clock_timestamp()
    end,
    updated_at = clock_timestamp()
  where request.user_id = target_user_id
    and request.client_request_id = target_client_request_id
    and request.phase = expected_phase
  returning
    request.user_id,
    request.client_request_id,
    request.phase,
    request.recent_login_verified_at,
    request.attempt_count,
    request.last_error_code,
    request.updated_at;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'ACCOUNT_DELETION_STATE_CONFLICT';
  end if;
end;
$$;

create or replace function public.get_account_deletion_auth_state(
  target_user_id uuid
)
returns table (
  user_exists boolean,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth_user.id is not null,
    auth_user.last_sign_in_at
  from (select target_user_id as id) as requested_user
  left join auth.users as auth_user on auth_user.id = requested_user.id;
$$;

create or replace function public.list_account_deletion_storage_paths(
  target_user_id uuid,
  target_client_request_id uuid,
  after_storage_path text default null,
  page_size integer default 100
)
returns table (storage_path text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.account_deletion_requests as request
    where request.user_id = target_user_id
      and request.client_request_id = target_client_request_id
      and request.phase in ('auth_deleted', 'storage_deleting')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'ACCOUNT_DELETION_STORAGE_LIST_FORBIDDEN';
  end if;

  return query
  select object.name
  from storage.objects as object
  where object.bucket_id = 'profile-photos'
    -- Include legacy mixed-case owner prefixes that older policies could have
    -- accepted; new writes are canonical lowercase, but deletion must be
    -- exhaustive for historical objects too.
    and pg_catalog.lower(pg_catalog.split_part(object.name, '/', 1)) =
      target_user_id::text
    and pg_catalog.strpos(object.name, '/') > 0
    and object.name > coalesce(after_storage_path, '')
  order by object.name
  limit least(greatest(coalesce(page_size, 100), 1), 1000);
end;
$$;

revoke all on function private.profile_photo_path_is_owned(text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_path_has_owner_prefix(text, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_upload_is_allowed(text, jsonb, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.profile_photo_uploads_are_allowed(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.profile_photo_path_is_owned(text, uuid)
to authenticated;
grant execute on function private.profile_photo_path_has_owner_prefix(text, uuid)
to authenticated;
grant execute on function private.profile_photo_upload_is_allowed(text, jsonb, uuid)
to authenticated;
grant execute on function private.profile_photo_uploads_are_allowed(uuid)
to authenticated;

revoke all on function public.get_account_deletion_request(uuid)
from public, anon, authenticated;
revoke all on function public.get_verified_account_deletion_claims()
from public, anon, service_role;
revoke all on function public.begin_account_deletion_request(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.advance_account_deletion_request(uuid, uuid, text, text, text)
from public, anon, authenticated;
revoke all on function public.get_account_deletion_auth_state(uuid)
from public, anon, authenticated;
revoke all on function public.list_account_deletion_storage_paths(uuid, uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.get_account_deletion_request(uuid)
to service_role;
grant execute on function public.get_verified_account_deletion_claims()
to authenticated;
grant execute on function public.begin_account_deletion_request(uuid, uuid)
to service_role;
grant execute on function public.advance_account_deletion_request(uuid, uuid, text, text, text)
to service_role;
grant execute on function public.get_account_deletion_auth_state(uuid)
to service_role;
grant execute on function public.list_account_deletion_storage_paths(uuid, uuid, text, integer)
to service_role;

commit;

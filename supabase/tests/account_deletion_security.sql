begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

select has_table(
  'private',
  'account_deletion_requests',
  'account deletion request state is private'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'account_deletion_requests'
  ),
  'account deletion state has RLS enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'account_deletion_requests'
  ),
  'account deletion state forces RLS'
);

select is(
  (
    select count(*)
    from pg_constraint as constraint_definition
    where constraint_definition.conrelid =
      'private.account_deletion_requests'::regclass
      and constraint_definition.contype = 'f'
  ),
  0::bigint,
  'deletion state survives removal of the Auth user'
);

select is(
  (
    select count(*)
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege(name)
    where has_table_privilege(
      'anon',
      'private.account_deletion_requests',
      privilege.name
    )
  ),
  0::bigint,
  'anon has no direct deletion-state privileges'
);

select is(
  (
    select count(*)
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege(name)
    where has_table_privilege(
      'authenticated',
      'private.account_deletion_requests',
      privilege.name
    )
  ),
  0::bigint,
  'authenticated has no direct deletion-state privileges'
);

select is(
  (
    select count(*)
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privilege(name)
    where has_table_privilege(
      'service_role',
      'private.account_deletion_requests',
      privilege.name
    )
  ),
  0::bigint,
  'service_role reaches deletion state only through bounded RPCs'
);

select is(
  (
    with protected_rpc(procedure_oid) as (
      values
        ('public.get_account_deletion_request(uuid)'::regprocedure),
        ('public.begin_account_deletion_request(uuid,uuid)'::regprocedure),
        (
          'public.advance_account_deletion_request(uuid,uuid,text,text,text)'
            ::regprocedure
        ),
        ('public.get_account_deletion_auth_state(uuid)'::regprocedure),
        (
          'public.list_account_deletion_storage_paths(uuid,uuid,text,integer)'
            ::regprocedure
        )
    )
    select count(*)
    from protected_rpc
    where has_function_privilege(
      'service_role',
      procedure_oid,
      'EXECUTE'
    )
  ),
  5::bigint,
  'service_role can execute all deletion orchestration RPCs'
);

select is(
  (
    with protected_rpc(procedure_oid) as (
      values
        ('public.get_account_deletion_request(uuid)'::regprocedure),
        ('public.begin_account_deletion_request(uuid,uuid)'::regprocedure),
        (
          'public.advance_account_deletion_request(uuid,uuid,text,text,text)'
            ::regprocedure
        ),
        ('public.get_account_deletion_auth_state(uuid)'::regprocedure),
        (
          'public.list_account_deletion_storage_paths(uuid,uuid,text,integer)'
            ::regprocedure
        )
    )
    select count(*)
    from protected_rpc
    where has_function_privilege('anon', procedure_oid, 'EXECUTE')
  ),
  0::bigint,
  'anon cannot execute deletion orchestration RPCs'
);

select is(
  (
    with protected_rpc(procedure_oid) as (
      values
        ('public.get_account_deletion_request(uuid)'::regprocedure),
        ('public.begin_account_deletion_request(uuid,uuid)'::regprocedure),
        (
          'public.advance_account_deletion_request(uuid,uuid,text,text,text)'
            ::regprocedure
        ),
        ('public.get_account_deletion_auth_state(uuid)'::regprocedure),
        (
          'public.list_account_deletion_storage_paths(uuid,uuid,text,integer)'
            ::regprocedure
        )
    )
    select count(*)
    from protected_rpc
    where has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
  ),
  0::bigint,
  'authenticated cannot execute deletion orchestration RPCs'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_verified_account_deletion_claims()',
    'EXECUTE'
  ),
  'authenticated JWTs can use the scoped claim verifier'
);

select is(
  (
    select count(*)
    from unnest(array['anon', 'service_role']) as role_name(name)
    where has_function_privilege(
      role_name.name,
      'public.get_verified_account_deletion_claims()',
      'EXECUTE'
    )
  ),
  0::bigint,
  'anon and service-role tokens cannot impersonate the scoped verifier'
);

select is(
  (select bucket.public from storage.buckets as bucket where bucket.id = 'profile-photos'),
  false,
  'profile photo bucket is private'
);

select is(
  (
    select bucket.file_size_limit
    from storage.buckets as bucket
    where bucket.id = 'profile-photos'
  ),
  6291456::bigint,
  'profile photo bucket enforces the 6 MiB limit'
);

select is(
  (
    select bucket.allowed_mime_types
    from storage.buckets as bucket
    where bucket.id = 'profile-photos'
  ),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    ::text[],
  'profile photo bucket allows only the supported image MIME types'
);

select ok(
  private.profile_photo_path_is_owned(
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '11111111-1111-4111-8111-111111111111'
  ),
  'an exact owner/file path is valid'
);

select ok(
  not private.profile_photo_path_is_owned(
    '11111111-1111-4111-8111-111111111111/nested/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '11111111-1111-4111-8111-111111111111'
  ),
  'nested upload paths are rejected'
);

select ok(
  not private.profile_photo_path_is_owned(
    '22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '11111111-1111-4111-8111-111111111111'
  ),
  'another owner path is rejected'
);

select ok(
  private.profile_photo_path_has_owner_prefix(
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/legacy/deep/photo.jpg',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'owner-prefix matching accepts a mixed-case legacy owner and nested path'
);

select ok(
  not private.profile_photo_path_has_owner_prefix(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab/legacy/photo.jpg',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'owner-prefix matching rejects another exact owner segment'
);

select ok(
  not private.profile_photo_path_is_owned(
    '11111111-1111-4111-8111-111111111111/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.jpg',
    '11111111-1111-4111-8111-111111111111'
  ),
  'non-canonical uppercase object names are rejected so cleanup cannot miss them'
);

select ok(
  not private.profile_photo_path_is_owned(
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg.extra',
    '11111111-1111-4111-8111-111111111111'
  ),
  'object names with a suffix after the supported extension are rejected'
);

select ok(
  private.profile_photo_upload_is_allowed(
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '{"mimetype":"image/jpeg","size":6291456}'::jsonb,
    '11111111-1111-4111-8111-111111111111'
  ),
  'matching extension, MIME, and bounded size are accepted'
);

select ok(
  not private.profile_photo_upload_is_allowed(
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
    '{"mimetype":"image/png","size":1024}'::jsonb,
    '11111111-1111-4111-8111-111111111111'
  ),
  'extension and MIME mismatch is rejected'
);

select ok(
  not private.profile_photo_upload_is_allowed(
    '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
    '{"mimetype":"image/png","size":6291457}'::jsonb,
    '11111111-1111-4111-8111-111111111111'
  ),
  'an upload over 6 MiB is rejected'
);

select ok(
  not private.profile_photo_upload_is_allowed(
    '11111111-1111-4111-8111-111111111111/dddddddd-dddd-4ddd-8ddd-dddddddddddd.gif',
    '{"mimetype":"image/gif","size":1024}'::jsonb,
    '11111111-1111-4111-8111-111111111111'
  ),
  'unsupported extensions and MIME types are rejected'
);

select is(
  (
    select count(*)
    from pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'profile_photo_storage_insert',
        'profile_photo_storage_update',
        'profile_photo_storage_delete'
      )
      and policy.roles = array['authenticated']::name[]
  ),
  3::bigint,
  'all profile photo write policies are authenticated-only'
);

select ok(
  coalesce(
    (
      select policy.with_check
      from pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'profile_photo_storage_insert'
    ),
    ''
  ) like '%profile_photo_upload_is_allowed(name, metadata, auth.uid())%',
  'insert policy enforces owner path, extension, MIME, size, and deletion state'
);

select ok(
  coalesce(
    (
      select policy.qual || ' ' || policy.with_check
      from pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'profile_photo_storage_update'
    ),
    ''
  ) like '%profile_photo_uploads_are_allowed(auth.uid())%'
  and coalesce(
    (
      select policy.with_check
      from pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'profile_photo_storage_update'
    ),
    ''
  ) like '%profile_photo_upload_is_allowed(name, metadata, auth.uid())%',
  'update policy enforces active-deletion and complete upload validation'
);

select ok(
  coalesce(
    (
      select policy.qual
      from pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'profile_photo_storage_delete'
    ),
    ''
  ) like '%profile_photo_path_has_owner_prefix(name, auth.uid())%',
  'delete policy is restricted to the owner-scoped legacy cleanup helper'
);

select ok(
  coalesce(
    (
      select policy.qual
      from pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = 'profile_photo_storage_select'
    ),
    ''
  ) like '%profile_photo_path_has_owner_prefix(name, auth.uid())%',
  'select policy exposes owner-scoped legacy paths for targeted deletion'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '11111111-1111-4111-8111-111111111111',
    'role', 'authenticated',
    'iat', 1788091170
  )::text,
  true
);

select is(
  (
    select claims.user_id
    from public.get_verified_account_deletion_claims() as claims
  ),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'scoped verifier returns only the authenticated JWT subject'
);

select lives_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '10000000-0000-4000-8000-000000000001',
      'profile-photos',
      '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
      '{"mimetype":"image/jpeg","size":6291456}'::jsonb
    )
  $$,
  'authenticated owner can insert an exact valid profile photo'
);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '10000000-0000-4000-8000-000000000002',
      'profile-photos',
      '11111111-1111-4111-8111-111111111111/nested/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png',
      '{"mimetype":"image/png","size":1024}'::jsonb
    )
  $$,
  '42501',
  null,
  'RLS rejects a nested upload path'
);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '10000000-0000-4000-8000-000000000003',
      'profile-photos',
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
      '{"mimetype":"image/png","size":1024}'::jsonb
    )
  $$,
  '42501',
  null,
  'RLS rejects an extension and MIME mismatch'
);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '10000000-0000-4000-8000-000000000004',
      'profile-photos',
      '11111111-1111-4111-8111-111111111111/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
      '{"mimetype":"image/png","size":6291457}'::jsonb
    )
  $$,
  '42501',
  null,
  'RLS rejects an oversized upload'
);

reset role;

select is(
  (
    select request.phase
    from public.begin_account_deletion_request(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ) as request
  ),
  'requested',
  'service RPC creates resumable requested state'
);

select ok(
  not private.profile_photo_uploads_are_allowed(
    '11111111-1111-4111-8111-111111111111'
  ),
  'an active deletion request blocks uploads'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$
    insert into storage.objects (id, bucket_id, name, metadata)
    values (
      '10000000-0000-4000-8000-000000000005',
      'profile-photos',
      '11111111-1111-4111-8111-111111111111/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp',
      '{"mimetype":"image/webp","size":1024}'::jsonb
    )
  $$,
  '42501',
  null,
  'RLS blocks a valid upload while deletion is active'
);

reset role;

select throws_ok(
  $$
    select public.list_account_deletion_storage_paths(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      null,
      100
    )
  $$,
  'P0001',
  'ACCOUNT_DELETION_STORAGE_LIST_FORBIDDEN',
  'Storage paths cannot be listed before Auth deletion is recorded'
);

select is(
  (
    select request.phase
    from public.advance_account_deletion_request(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'requested',
      'auth_deleted',
      null
    ) as request
  ),
  'auth_deleted',
  'service RPC records Auth deletion before Storage cleanup'
);

insert into storage.objects (id, bucket_id, name, metadata)
values
  (
    '10000000-0000-4000-8000-000000000006',
    'profile-photos',
    '11111111-1111-4111-8111-111111111111/legacy/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
    '{"mimetype":"image/png","size":1024}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000007',
    'profile-photos',
    '11111111-1111-4111-8111-111111111111/legacy/deep/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
    '{"mimetype":"image/webp","size":1024}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    'profile-photos',
    '22222222-2222-4222-8222-222222222222/ffffffff-ffff-4fff-8fff-ffffffffffff.jpg',
    '{"mimetype":"image/jpeg","size":1024}'::jsonb
  );

select is(
  (
    select array_agg(path.storage_path order by path.storage_path)
    from public.list_account_deletion_storage_paths(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      null,
      100
    ) as path
  ),
  array[
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',
    '11111111-1111-4111-8111-111111111111/legacy/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
    '11111111-1111-4111-8111-111111111111/legacy/deep/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp'
  ]::text[],
  'cleanup enumeration includes recursive owner paths and excludes other owners'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11111111-1111-4111-8111-111111111111',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('storage.allow_delete_query', 'true', true);

select is(
  (
    select count(*)
    from storage.objects
    where id = '10000000-0000-4000-8000-000000000007'
  ),
  1::bigint,
  'authenticated owner can select its legacy nested object for targeted deletion'
);

select is(
  (
    select count(*)
    from storage.objects
    where id = '10000000-0000-4000-8000-000000000008'
  ),
  0::bigint,
  'owner-prefix visibility does not expose another owner object'
);

select lives_ok(
  $$
    delete from storage.objects
    where id = '10000000-0000-4000-8000-000000000007'
  $$,
  'authenticated cleanup can target its own legacy nested object'
);

select lives_ok(
  $$
    delete from storage.objects
    where id = '10000000-0000-4000-8000-000000000008'
  $$,
  'authenticated cleanup can issue a delete against another owner without leakage'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where id = '10000000-0000-4000-8000-000000000007'
  ),
  0::bigint,
  'authenticated cleanup deletes its own legacy nested object'
);

select is(
  (
    select count(*)
    from storage.objects
    where id = '10000000-0000-4000-8000-000000000008'
  ),
  1::bigint,
  'delete policy preserves another owner object'
);

select is(
  (
    select request.phase
    from public.advance_account_deletion_request(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'auth_deleted',
      'storage_deleting',
      null
    ) as request
  ),
  'storage_deleting',
  'service RPC records the Storage cleanup phase'
);

select is(
  (
    select request.phase
    from public.advance_account_deletion_request(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'storage_deleting',
      'completed',
      null
    ) as request
  ),
  'completed',
  'service RPC completes deletion state'
);

select ok(
  not private.profile_photo_uploads_are_allowed(
    '11111111-1111-4111-8111-111111111111'
  ),
  'completed deletion state permanently blocks uploads from lingering JWTs'
);

select is(
  (
    select request.user_id
    from public.begin_account_deletion_request(
      '22222222-2222-4222-8222-222222222222',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ) as request
  ),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'a globally unique request id cannot be claimed by another user'
);

select throws_ok(
  $$
    select public.advance_account_deletion_request(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'completed',
      'requested',
      null
    )
  $$,
  '22023',
  'ACCOUNT_DELETION_INVALID_TRANSITION',
  'invalid or regressive phase transitions are rejected'
);

select is(
  (
    select request.phase
    from public.get_account_deletion_request(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ) as request
  ),
  'completed',
  'state lookup returns the durable completed request'
);

select * from finish();
rollback;

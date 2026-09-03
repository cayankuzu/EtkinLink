begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

-- Every RPC in `public` that reads `auth.uid()` is an owner-scoped client
-- surface. Supabase's default privileges hand `anon` and `service_role`
-- EXECUTE on each newly created function, so these invariants are what keep a
-- future migration from silently re-opening the boundary.

create temporary view owner_scoped_rpc as
select p.oid,
       p.proname,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%auth.uid()%';

select cmp_ok(
  (select count(*) from owner_scoped_rpc),
  '>=',
  40::bigint,
  'Owner-scoped RPC denetimi gerçek yüzeyi tarar'
);

select is(
  (
    select coalesce(string_agg(signature, ', ' order by signature), '')
    from owner_scoped_rpc
    where has_function_privilege('service_role', oid, 'EXECUTE')
  ),
  '',
  'Service role hiçbir owner-scoped client RPCsini çalıştıramaz'
);

-- `anon` keeps EXECUTE only where the product genuinely needs a pre-auth or
-- user-independent answer: the sign-up username availability check and the
-- public event catalog the edge cache may serve.
select is(
  (
    select coalesce(
      array_agg(proname::text order by proname::text),
      array[]::text[]
    )
    from owner_scoped_rpc
    where has_function_privilege('anon', oid, 'EXECUTE')
  ),
  array['get_event_detail', 'is_username_available', 'search_events'],
  'Anon yalnız kayıt öncesi ve public katalog uçlarını çalıştırabilir'
);

-- The hardening must not have taken anything away from the signed-in app.
select is(
  (
    select coalesce(string_agg(signature, ', ' order by signature), '')
    from owner_scoped_rpc
    where not has_function_privilege('authenticated', oid, 'EXECUTE')
      and proname <> 'get_verified_account_deletion_claims'
  ),
  '',
  'Authenticated kullanıcı mevcut client RPC yüzeyini kaybetmez'
);

-- The worker RPCs are the only sanctioned service-role entry points, and they
-- stay closed to both client roles.
select is(
  (
    select count(*)
    from unnest(array[
      'public.claim_notification_event(uuid)',
      'public.claim_notification_events(integer)',
      'public.claim_pending_push_receipts(integer)',
      'public.ingest_events_batch(jsonb)',
      'public.consume_push_worker_nonce(uuid,text,bigint)'
    ]) as worker_rpc(signature)
    where has_function_privilege('service_role', worker_rpc.signature, 'EXECUTE')
  ),
  5::bigint,
  'Worker RPCleri service role için açık kalır'
);

select is(
  (
    select count(*)
    from unnest(array[
      'public.claim_notification_event(uuid)',
      'public.claim_notification_events(integer)',
      'public.claim_pending_push_receipts(integer)',
      'public.ingest_events_batch(jsonb)',
      'public.consume_push_worker_nonce(uuid,text,bigint)'
    ]) as worker_rpc(signature)
    cross join unnest(array['anon', 'authenticated']) as client_role(name)
    where has_function_privilege(
      client_role.name,
      worker_rpc.signature,
      'EXECUTE'
    )
  ),
  0::bigint,
  'Worker RPCleri hiçbir client rolüne açılmaz'
);

select * from finish();
rollback;

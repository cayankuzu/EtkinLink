begin;

create extension if not exists pgtap with schema extensions;
select plan(36);

select has_table(
  'private',
  'account_deletion_worker_nonces',
  'account deletion worker nonces are private'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'private.account_deletion_worker_nonces'::regclass
  ),
  'worker nonce RLS is enabled'
);

select ok(
  (
    select relation.relforcerowsecurity
    from pg_class as relation
    where relation.oid = 'private.account_deletion_worker_nonces'::regclass
  ),
  'worker nonce RLS is forced'
);

select is(
  (
    select count(*)
    from information_schema.columns as column_definition
    where column_definition.table_schema = 'private'
      and column_definition.table_name = 'account_deletion_requests'
      and column_definition.column_name in (
        'continuation_attempt_count',
        'continuation_next_attempt_at',
        'continuation_lease_until',
        'continuation_terminal_at',
        'continuation_last_error_code',
        'continuation_last_error_at'
      )
  ),
  6::bigint,
  'continuation retry, lease, error and terminal state is durable'
);

select is(
  (
    with worker_rpc(procedure_oid) as (
      values
        ('public.consume_account_deletion_worker_nonce(uuid,bigint)'::regprocedure),
        ('public.claim_account_deletion_continuations(integer)'::regprocedure),
        (
          'public.release_account_deletion_continuation_claim(uuid,uuid,integer,text,text)'
            ::regprocedure
        ),
        (
          'public.list_terminal_account_deletion_continuations(integer)'
            ::regprocedure
        )
    )
    select count(*)
    from worker_rpc
    where has_function_privilege('service_role', procedure_oid, 'EXECUTE')
  ),
  4::bigint,
  'service role can execute the bounded continuation RPC surface'
);

select is(
  (
    with worker_rpc(procedure_oid) as (
      values
        ('public.consume_account_deletion_worker_nonce(uuid,bigint)'::regprocedure),
        ('public.claim_account_deletion_continuations(integer)'::regprocedure),
        (
          'public.release_account_deletion_continuation_claim(uuid,uuid,integer,text,text)'
            ::regprocedure
        ),
        (
          'public.list_terminal_account_deletion_continuations(integer)'
            ::regprocedure
        )
    )
    select count(*)
    from worker_rpc
    where has_function_privilege('anon', procedure_oid, 'EXECUTE')
  ),
  0::bigint,
  'anon cannot execute continuation RPCs'
);

select is(
  (
    with worker_rpc(procedure_oid) as (
      values
        ('public.consume_account_deletion_worker_nonce(uuid,bigint)'::regprocedure),
        ('public.claim_account_deletion_continuations(integer)'::regprocedure),
        (
          'public.release_account_deletion_continuation_claim(uuid,uuid,integer,text,text)'
            ::regprocedure
        ),
        (
          'public.list_terminal_account_deletion_continuations(integer)'
            ::regprocedure
        )
    )
    select count(*)
    from worker_rpc
    where has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
  ),
  0::bigint,
  'authenticated users cannot execute continuation RPCs'
);

select is(
  (
    select count(*)
    from unnest(array[
      'private.account_deletion_requests',
      'private.account_deletion_worker_nonces'
    ]) as protected_table(name)
    where has_table_privilege('service_role', protected_table.name, 'SELECT')
  ),
  0::bigint,
  'service role reaches private continuation state only through RPCs'
);

select is(
  (
    select count(*)
    from cron.job
    where jobname = 'etkinlink-account-deletion-continuations'
      and schedule = '* * * * *'
  ),
  1::bigint,
  'one production continuation scheduler is installed'
);

set local role service_role;

select ok(
  public.consume_account_deletion_worker_nonce(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    floor(extract(epoch from clock_timestamp()))::bigint
  ),
  'a fresh signed-worker nonce is consumed once'
);

select ok(
  not public.consume_account_deletion_worker_nonce(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    floor(extract(epoch from clock_timestamp()))::bigint
  ),
  'the same worker nonce cannot be replayed'
);

select ok(
  not public.consume_account_deletion_worker_nonce(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    floor(extract(epoch from clock_timestamp() - interval '10 minutes'))::bigint
  ),
  'a stale worker timestamp is rejected'
);

reset role;

insert into private.account_deletion_requests (
  user_id,
  client_request_id,
  phase,
  auth_deleted_at,
  continuation_next_attempt_at
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'auth_deleted',
  clock_timestamp(),
  clock_timestamp()
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  1::bigint,
  'a due continuation is leased'
);

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  0::bigint,
  'an active lease prevents a duplicate claim'
);

reset role;

select is(
  (
    select continuation_attempt_count
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000001'
  ),
  1::smallint,
  'claiming increments the dedicated continuation attempt'
);

set local role service_role;

select is(
  (
    select result.accepted
    from public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      2,
      'failed',
      'CONTINUATION_STORAGE_DELETE_FAILED'
    ) as result
  ),
  false,
  'a stale attempt cannot release another worker lease'
);

select is(
  (
    select result.accepted
    from public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      1,
      'failed',
      'CONTINUATION_STORAGE_DELETE_FAILED'
    ) as result
  ),
  true,
  'the current worker can release a failed lease'
);

reset role;

select ok(
  (
    select continuation_terminal_at is null
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000001'
  ),
  'an early failure remains retryable'
);

select ok(
  (
    select continuation_next_attempt_at > clock_timestamp()
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000001'
  ),
  'a failed continuation receives future backoff'
);

select is(
  (
    select continuation_last_error_code
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000001'
  ),
  'CONTINUATION_STORAGE_DELETE_FAILED',
  'the sanitized continuation error is observable'
);

update private.account_deletion_requests
set
  continuation_attempt_count = 7,
  continuation_next_attempt_at = clock_timestamp() - interval '1 second'
where client_request_id = '20000000-0000-4000-8000-000000000001';

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  1::bigint,
  'the final bounded attempt can be claimed'
);

select is(
  (
    select result.terminal
    from public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      8,
      'failed',
      'CONTINUATION_STORAGE_DELETE_FAILED'
    ) as result
  ),
  true,
  'the eighth failed attempt becomes terminal'
);

reset role;

select ok(
  (
    select continuation_terminal_at is not null
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000001'
  ),
  'terminal continuation time is durable'
);

set local role service_role;

select is(
  (
    select count(*)
    from public.list_terminal_account_deletion_continuations(100) as terminal
    where terminal.client_request_id =
      '20000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'terminal continuation is exposed through service-only observability'
);

reset role;

insert into private.account_deletion_requests (
  user_id,
  client_request_id,
  phase,
  storage_deleting_at,
  continuation_attempt_count,
  continuation_next_attempt_at
) values (
  '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002',
  'storage_deleting',
  clock_timestamp(),
  7,
  clock_timestamp()
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  1::bigint,
  'an eighth-attempt lease is bounded like other claims'
);

reset role;

update private.account_deletion_requests
set continuation_lease_until = clock_timestamp() - interval '1 second'
where client_request_id = '20000000-0000-4000-8000-000000000002';

set local role service_role;

select is(
  (
    select count(*)
    from public.list_terminal_account_deletion_continuations(100) as terminal
    where terminal.client_request_id =
      '20000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'an abandoned final lease is automatically terminalized'
);

reset role;

select is(
  (
    select continuation_last_error_code
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000002'
  ),
  'CONTINUATION_LEASE_EXPIRED',
  'expired final lease has a stable terminal error code'
);

insert into private.account_deletion_requests (
  user_id,
  client_request_id,
  phase,
  storage_deleting_at,
  continuation_next_attempt_at
) values (
  '10000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000003',
  'storage_deleting',
  clock_timestamp(),
  clock_timestamp()
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  1::bigint,
  'a large Storage cleanup receives a bounded claim'
);

select is(
  (
    select result.accepted
    from public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000003',
      1,
      'resumable',
      null
    ) as result
  ),
  true,
  'a bounded partial cleanup can be released as resumable'
);

reset role;

select ok(
  (
    select continuation_attempt_count = 0
      and continuation_terminal_at is null
      and continuation_next_attempt_at > clock_timestamp()
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000003'
  ),
  'resumable progress resets the failure budget and schedules another chunk'
);

insert into private.account_deletion_requests (
  user_id,
  client_request_id,
  phase,
  storage_deleting_at,
  continuation_next_attempt_at
) values (
  '10000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000004',
  'storage_deleting',
  clock_timestamp(),
  clock_timestamp()
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(1)
  ),
  1::bigint,
  'a completing cleanup is leased'
);

reset role;

update private.account_deletion_requests
set phase = 'completed', completed_at = clock_timestamp()
where client_request_id = '20000000-0000-4000-8000-000000000004';

set local role service_role;

select is(
  (
    select result.accepted
    from public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000004',
      1,
      'completed',
      null
    ) as result
  ),
  true,
  'a completed saga clears its worker lease with CAS'
);

reset role;

select ok(
  (
    select continuation_lease_until is null
      and continuation_next_attempt_at is null
      and continuation_last_error_code is null
    from private.account_deletion_requests
    where client_request_id = '20000000-0000-4000-8000-000000000004'
  ),
  'completed continuation has no pending worker state'
);

insert into private.account_deletion_requests (
  user_id,
  client_request_id,
  phase,
  auth_deleted_at,
  continuation_next_attempt_at
)
select
  gen_random_uuid(),
  gen_random_uuid(),
  'auth_deleted',
  clock_timestamp(),
  clock_timestamp()
from generate_series(1, 11);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_account_deletion_continuations(999)
  ),
  10::bigint,
  'continuation claim batch is capped at ten rows'
);

select throws_ok(
  $$
    select public.release_account_deletion_continuation_claim(
      '10000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000003',
      0,
      'failed',
      'CONTINUATION_UNEXPECTED'
    )
  $$,
  '22023',
  'ACCOUNT_DELETION_CONTINUATION_RELEASE_INVALID',
  'invalid continuation release arguments fail closed'
);

reset role;

select ok(
  not has_function_privilege(
    'service_role',
    'private.invoke_account_deletion_worker()',
    'EXECUTE'
  ),
  'service role cannot call the private scheduler transport directly'
);

select * from finish();
rollback;

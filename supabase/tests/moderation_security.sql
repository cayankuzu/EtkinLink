begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(61);

select ok(
  to_regprocedure(
    'public.submit_report(uuid,public.report_reason,text,uuid,uuid,jsonb,boolean,uuid)'
  ) is not null,
  'submit_report exposes the idempotency-aware signature'
);

select ok(
  to_regprocedure(
    'public.submit_report(uuid,public.report_reason,text,uuid,uuid,jsonb,boolean)'
  ) is null,
  'the obsolete submit_report overload is removed'
);

select ok(
  to_regprocedure('public.submit_room_report(uuid,text,text,uuid)') is not null,
  'submit_room_report exposes the idempotency-aware signature'
);

select ok(
  to_regprocedure('public.submit_room_report(uuid,text,text)') is null,
  'the obsolete submit_room_report overload is removed'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.submit_report(uuid,public.report_reason,text,uuid,uuid,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'anon cannot submit user reports'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.submit_report(uuid,public.report_reason,text,uuid,uuid,jsonb,boolean,uuid)',
    'EXECUTE'
  ),
  'authenticated users retain report submission access'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.submit_room_report(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'anon cannot submit room reports'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.submit_room_report(uuid,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated users retain room report submission access'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.moderation_case_transition(uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ),
  'authenticated users cannot transition moderation cases'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.moderation_case_transition(uuid,text,text,text,text,uuid,text)',
    'EXECUTE'
  ),
  'service role can transition moderation cases through the guarded RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.get_moderation_case(uuid)',
    'EXECUTE'
  ),
  'authenticated users cannot read private moderation cases through the RPC'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.get_moderation_case(uuid)',
    'EXECUTE'
  ),
  'service role can read a moderation case through the guarded RPC'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.moderation_cases',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'authenticated users have no direct moderation case privilege'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.moderation_cases',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service role cannot bypass the moderation case RPC with direct DML'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'private.moderation_audit_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'authenticated users have no direct audit privilege'
);

select ok(
  not has_table_privilege(
    'service_role',
    'private.moderation_audit_events',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'service role cannot mutate or read audit rows directly'
);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname in ('moderation_cases', 'moderation_audit_events')
      and not relation.relrowsecurity
  ),
  0::bigint,
  'private moderation tables have RLS enabled'
);

select is(
  (
    select count(*)
    from pg_trigger as trigger
    join pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'private'
      and relation.relname = 'moderation_audit_events'
      and trigger.tgname in (
        'moderation_audit_events_no_update_delete',
        'moderation_audit_events_no_truncate'
      )
      and not trigger.tgisinternal
  ),
  2::bigint,
  'audit rows are guarded against update, delete, and truncate'
);

select ok(
  (
    select function.prosrc
    from pg_proc as function
    join pg_namespace as namespace
      on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.oid =
        'public.submit_report(uuid,public.report_reason,text,uuid,uuid,jsonb,boolean,uuid)'::regprocedure
  ) like '%pg_advisory_xact_lock%moderation-report-rate:%',
  'submit_report takes the shared per-user transaction lock'
);

select ok(
  (
    select function.prosrc
    from pg_proc as function
    join pg_namespace as namespace
      on namespace.oid = function.pronamespace
    where namespace.nspname = 'public'
      and function.oid =
        'public.submit_room_report(uuid,text,text,uuid)'::regprocedure
  ) like '%pg_advisory_xact_lock%moderation-report-rate:%',
  'submit_room_report takes the same per-user transaction lock'
);

select ok(
  exists (
    select 1
    from pg_constraint as table_constraint
    where table_constraint.conrelid = 'public.moderation_reports'::regclass
      and table_constraint.conname = 'moderation_client_context_shape'
      and table_constraint.convalidated
  ),
  'stored client context has a validated shape and size constraint'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'moderation_reports'
      and indexname = 'moderation_reports_request_id_idx'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'user report request IDs are unique per reporter'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'room_reports'
      and indexname = 'room_reports_request_id_idx'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'room report request IDs are unique per reporter'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'moderation-a@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Moderation User A"}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'moderation-b@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Moderation User B"}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'moderation-c@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Moderation User C"}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'moderation-d@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Moderation User D"}', now(), now()
  );

update public.profiles
set username = case id
      when '00000000-0000-4000-8000-000000000101' then 'moderation_user_a'
      when '00000000-0000-4000-8000-000000000102' then 'moderation_user_b'
      when '00000000-0000-4000-8000-000000000103' then 'moderation_user_c'
      else 'moderation_user_d'
    end,
    birth_date = date '1990-01-01',
    gender = 'prefer_not_to_say',
    city = 'Istanbul',
    onboarding_completed = true,
    email_verified = true
where id in (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000104'
);

insert into public.events (
  id, source_guid, source_url, title, start_at, end_at, city
)
values
  (
    '11000000-0000-4000-8000-000000000101',
    'moderation-event-one',
    'https://example.test/moderation-event-one',
    'Moderation Event One',
    now() + interval '1 hour',
    now() + interval '3 hours',
    'Istanbul'
  ),
  (
    '11000000-0000-4000-8000-000000000102',
    'moderation-event-two',
    'https://example.test/moderation-event-two',
    'Moderation Event Two',
    now() + interval '2 hours',
    now() + interval '4 hours',
    'Istanbul'
  );

insert into public.event_attendees (event_id, user_id, status)
values
  ('11000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101', 'joined'),
  ('11000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', 'joined'),
  ('11000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'joined'),
  ('11000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103', 'joined');

insert into public.matches (id, event_id, user1_id, user2_id, status)
values (
  '22000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  'active'
);

insert into public.user_blocks (blocker_id, blocked_id)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000104'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000101',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000103',
      'other',
      'Visible public profile report with enough detail.',
      null,
      null,
      '{"source":"public_profile"}'::jsonb,
      false
    )
  $$,
  'the existing seven-argument report call remains compatible'
);

select set_config(
  'test.moderation_report_id',
  public.submit_report(
    '00000000-0000-4000-8000-000000000102',
    'harassment',
    'Matched-user report with stable idempotent details.',
    '11000000-0000-4000-8000-000000000101',
    '22000000-0000-4000-8000-000000000101',
    '{"platform":"ios","source":"direct_chat","app_version":"1.2.3"}'::jsonb,
    false,
    '33000000-0000-4000-8000-000000000101'
  )::text,
  true
);

select is(
  public.submit_report(
    '00000000-0000-4000-8000-000000000102',
    'harassment',
    'Matched-user report with stable idempotent details.',
    '11000000-0000-4000-8000-000000000101',
    '22000000-0000-4000-8000-000000000101',
    '{"platform":"ios","source":"direct_chat","app_version":"1.2.3"}'::jsonb,
    false,
    '33000000-0000-4000-8000-000000000101'
  )::text,
  current_setting('test.moderation_report_id'),
  'an exact user report replay returns the original row'
);

select is(
  (
    select count(*)
    from public.moderation_reports
    where client_request_id = '33000000-0000-4000-8000-000000000101'
  ),
  1::bigint,
  'an idempotent user report replay creates one row'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000102',
      'harassment',
      'Changed payload cannot reuse the same request identifier.',
      '11000000-0000-4000-8000-000000000101',
      '22000000-0000-4000-8000-000000000101',
      '{"platform":"ios","source":"direct_chat","app_version":"1.2.3"}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000101'
    )
  $$,
  '22023',
  null,
  'a reused report request ID rejects a changed payload'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000103',
      'other',
      'Malformed array context must be rejected safely.',
      null,
      null,
      '[]'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000102'
    )
  $$,
  '22023',
  null,
  'non-object client context is rejected'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000103',
      'other',
      'Unknown client context keys must be rejected safely.',
      null,
      null,
      '{"unexpected":true}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000103'
    )
  $$,
  '22023',
  null,
  'unknown client context fields are rejected'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000103',
      'other',
      'Oversized client context must be rejected safely.',
      null,
      null,
      jsonb_build_object('screen', repeat('a', 1100)),
      false,
      '33000000-0000-4000-8000-000000000104'
    )
  $$,
  '22023',
  null,
  'oversized client context is rejected'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000103',
      'other',
      'An unrelated user cannot be attached to another match.',
      null,
      '22000000-0000-4000-8000-000000000101',
      '{}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000105'
    )
  $$,
  '42501',
  null,
  'an unrelated target cannot borrow a visible match context'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000102',
      'other',
      'A target outside the selected event is not reportable there.',
      '11000000-0000-4000-8000-000000000102',
      null,
      '{}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000106'
    )
  $$,
  '42501',
  null,
  'an unrelated event context is rejected'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000102',
      'other',
      'The event identifier must agree with the selected match.',
      '11000000-0000-4000-8000-000000000102',
      '22000000-0000-4000-8000-000000000101',
      '{}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000107'
    )
  $$,
  '42501',
  null,
  'a mismatched event and match context is rejected'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000104',
      'other',
      'A blocked target must no longer be reportable as visible.',
      null,
      null,
      '{}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000108'
    )
  $$,
  '42501',
  null,
  'a blocked target is rejected'
);

reset role;

select ok(
  exists (
    select 1
    from private.moderation_cases as moderation_case
    join public.moderation_reports as report
      on report.id = moderation_case.source_report_id
      and moderation_case.source_kind = 'user_report'
    where report.client_request_id = '33000000-0000-4000-8000-000000000101'
      and moderation_case.state = 'pending'
      and moderation_case.sla_due_at > moderation_case.created_at
      and (
        select count(*)
        from private.moderation_audit_events as audit_event
        where audit_event.case_id = moderation_case.id
          and audit_event.event_type = 'submitted'
      ) = 1
  ),
  'report intake atomically creates a pending SLA-backed case and submission audit'
);

select set_config(
  'test.moderation_case_id',
  (
    select moderation_case.id::text
    from private.moderation_cases as moderation_case
    join public.moderation_reports as report
      on report.id = moderation_case.source_report_id
      and moderation_case.source_kind = 'user_report'
    where report.client_request_id = '33000000-0000-4000-8000-000000000101'
  ),
  true
);

insert into public.moderation_reports (
  reporter_user_id,
  target_user_id,
  event_id,
  reason,
  details,
  client_request_id
)
select
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  '11000000-0000-4000-8000-000000000101',
  'other',
  'Combined rate-limit fixture report number ' || fixture_number,
  ('33000000-0000-4000-8000-' || lpad((200 + fixture_number)::text, 12, '0'))::uuid
from generate_series(1, 4) as fixture_number;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000102',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config(
  'test.room_report_id',
  public.submit_room_report(
    '11000000-0000-4000-8000-000000000101',
    'spam',
    'The fifth combined report remains inside the hourly allowance.',
    '33000000-0000-4000-8000-000000000210'
  )::text,
  true
);

select is(
  public.submit_room_report(
    '11000000-0000-4000-8000-000000000101',
    'spam',
    'The fifth combined report remains inside the hourly allowance.',
    '33000000-0000-4000-8000-000000000210'
  )::text,
  current_setting('test.room_report_id'),
  'an exact room report replay succeeds even after reaching the limit'
);

select throws_ok(
  $$
    select public.submit_report(
      '00000000-0000-4000-8000-000000000101',
      'other',
      'A sixth report across both report surfaces must be rejected.',
      '11000000-0000-4000-8000-000000000101',
      null,
      '{}'::jsonb,
      false,
      '33000000-0000-4000-8000-000000000211'
    )
  $$,
  'P0001',
  null,
  'the shared hourly limit rejects a sixth report across both surfaces'
);

reset role;

select is(
  (
    select count(*)
    from public.moderation_reports
    where reporter_user_id = '00000000-0000-4000-8000-000000000102'
      and created_at > now() - interval '1 hour'
  ) + (
    select count(*)
    from public.room_reports
    where reporter_user_id = '00000000-0000-4000-8000-000000000102'
      and created_at > now() - interval '1 hour'
  ),
  5::bigint,
  'rate limiting and replay leave exactly five combined report rows'
);

select is(
  extensions.dblink_connect(
    'moderation_rate_lock',
    'hostaddr=' || host(inet_server_addr())
      || ' port=' || inet_server_port()::text
      || ' dbname=' || current_database()
      || ' user=postgres password=postgres'
  ),
  'OK',
  'a second database session opens for the report lock test'
);

do $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      'moderation-report-rate:00000000-0000-4000-8000-000000000104',
      0
    )
  );
end;
$$;

select is(
  (
    select lock_acquired
    from extensions.dblink(
      'moderation_rate_lock',
      format(
        'select pg_try_advisory_xact_lock(%s)',
        hashtextextended(
          'moderation-report-rate:00000000-0000-4000-8000-000000000104',
          0
        )
      )
    ) as remote_result(lock_acquired boolean)
  ),
  false,
  'a concurrent session cannot enter the same user report critical section'
);

select is(
  extensions.dblink_disconnect('moderation_rate_lock'),
  'OK',
  'the report lock test session closes cleanly'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  format(
    'select public.get_moderation_case(%L::uuid)',
    current_setting('test.moderation_case_id')
  ),
  '42501',
  null,
  'anon cannot read a private moderation case'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000101',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  format(
    'select public.get_moderation_case(%L::uuid)',
    current_setting('test.moderation_case_id')
  ),
  '42501',
  null,
  'authenticated users cannot call the private case reader'
);

select throws_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'start_review',
        'moderator-1',
        'SAFETY.1',
        'ticket/auth-denied',
        '44000000-0000-4000-8000-000000000100',
        'none'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  '42501',
  null,
  'authenticated users cannot transition a moderation case'
);

select throws_ok(
  $$ select count(*) from private.moderation_audit_events $$,
  '42501',
  null,
  'authenticated users cannot read private audit rows directly'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select set_config(
  'test.moderation_start_audit_id',
  public.moderation_case_transition(
    current_setting('test.moderation_case_id')::uuid,
    'start_review',
    'moderator-1',
    'SAFETY.1',
    'ticket/review-101',
    '44000000-0000-4000-8000-000000000101',
    'none'
  )::text,
  true
);

select is(
  public.moderation_case_transition(
    current_setting('test.moderation_case_id')::uuid,
    'start_review',
    'moderator-1',
    'SAFETY.1',
    'ticket/review-101',
    '44000000-0000-4000-8000-000000000101',
    'none'
  )::text,
  current_setting('test.moderation_start_audit_id'),
  'an exact service transition replay returns the original audit event'
);

select throws_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'resolve',
        'moderator-1',
        'SAFETY.1',
        'ticket/review-101',
        '44000000-0000-4000-8000-000000000101',
        'warning'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  '22023',
  null,
  'a service transition request ID cannot be reused with another payload'
);

select throws_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'resolve',
        null,
        'SAFETY.1',
        'ticket/invalid-owner',
        '44000000-0000-4000-8000-000000000199',
        'warning'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  '22023',
  null,
  'moderation transitions require a valid owner'
);

select is(
  public.get_moderation_case(
    current_setting('test.moderation_case_id')::uuid
  ) ->> 'state',
  'reviewing',
  'the service reader observes the reviewing state'
);

select lives_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'resolve',
        'moderator-1',
        'SAFETY.1',
        'ticket/resolve-101',
        '44000000-0000-4000-8000-000000000102',
        'warning'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  'service role can resolve a reviewing case with a recorded sanction'
);

select lives_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'appeal',
        'moderator-appeals',
        'APPEAL.1',
        'ticket/appeal-101',
        '44000000-0000-4000-8000-000000000103',
        'none'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  'service role can record an appeal of a resolved case'
);

select throws_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'resolve',
        'moderator-appeals',
        'APPEAL.1',
        'ticket/invalid-transition',
        '44000000-0000-4000-8000-000000000104',
        'warning'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  '22023',
  null,
  'an appealed case cannot skip the reopen transition'
);

select lives_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'reopen',
        'moderator-appeals',
        'APPEAL.1',
        'ticket/reopen-101',
        '44000000-0000-4000-8000-000000000105',
        'none'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  'service role can reopen an appealed case for review'
);

select lives_ok(
  format(
    $sql$
      select public.moderation_case_transition(
        %L::uuid,
        'resolve',
        'moderator-2',
        'SAFETY.2',
        'ticket/resolve-102',
        '44000000-0000-4000-8000-000000000106',
        'temporary_restriction'
      )
    $sql$,
    current_setting('test.moderation_case_id')
  ),
  'service role can resolve a reopened case'
);

select is(
  public.get_moderation_case(
    current_setting('test.moderation_case_id')::uuid
  ) ->> 'state',
  'resolved',
  'the service reader observes the final resolved state'
);

select ok(
  (
    select
      case_payload ->> 'assigned_owner' = 'moderator-2'
      and case_payload ->> 'policy_code' = 'SAFETY.2'
      and case_payload ->> 'sanction_code' = 'temporary_restriction'
      and case_payload ->> 'appeal_count' = '1'
      and case_payload ->> 'sla_due_at' is not null
      and case_payload ->> 'resolved_at' is not null
      and jsonb_array_length(case_payload -> 'audit_events') = 6
    from (
      select public.get_moderation_case(
        current_setting('test.moderation_case_id')::uuid
      ) as case_payload
    ) as guarded_case
  ),
  'owner, SLA, policy, sanction, appeal, and audit metadata remain enforced'
);

reset role;

select is(
  (
    select status
    from public.moderation_reports
    where id = current_setting('test.moderation_report_id')::uuid
  ),
  'resolved'::public.report_status,
  'the source report status follows the moderated case state'
);

select throws_ok(
  format(
    'update private.moderation_audit_events set actor_ticket = %L where case_id = %L::uuid',
    'ticket/tamper',
    current_setting('test.moderation_case_id')
  ),
  '55000',
  'Moderation audit events are append-only.',
  'even the database owner cannot update an audit event through ordinary DML'
);

select throws_ok(
  format(
    'delete from private.moderation_audit_events where case_id = %L::uuid',
    current_setting('test.moderation_case_id')
  ),
  '55000',
  'Moderation audit events are append-only.',
  'even the database owner cannot delete an audit event through ordinary DML'
);

select throws_ok(
  $$ truncate table private.moderation_audit_events $$,
  '55000',
  'Moderation audit events are append-only.',
  'even the database owner cannot truncate the audit log'
);

select is(
  (
    select count(*)
    from private.moderation_audit_events
    where case_id = current_setting('test.moderation_case_id')::uuid
  ),
  6::bigint,
  'failed audit mutations leave the complete append-only history intact'
);

select * from finish();
rollback;

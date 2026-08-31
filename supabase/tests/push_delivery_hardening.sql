begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select ok(
  not has_function_privilege(
    'anon',
    'public.consume_push_worker_nonce(uuid,text,bigint)',
    'EXECUTE'
  ),
  'Anon worker nonce tüketemez'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.consume_push_worker_nonce(uuid,text,bigint)',
    'EXECUTE'
  ),
  'Authenticated worker nonce tüketemez'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.consume_push_worker_nonce(uuid,text,bigint)',
    'EXECUTE'
  ),
  'Yalnız service role worker nonce tüketebilir'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.push_worker_nonces',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'Service role nonce tablosuna doğrudan erişemez'
);

select is(
  (
    select count(*)
    from unnest(array['anon', 'authenticated']) as role_name(name)
    where has_function_privilege(
      role_name.name,
      'public.persist_invalid_push_receipt(uuid,integer,text,text)',
      'EXECUTE'
    )
  ),
  0::bigint,
  'Client roles invalid-token receipt sonucunu kalıcılaştıramaz'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.persist_invalid_push_receipt(uuid,integer,text,text)',
    'EXECUTE'
  ),
  'Yalnız service role invalid-token receipt sonucunu kalıcılaştırabilir'
);

select is(
  public.consume_push_worker_nonce(
    '40000000-0000-4000-8000-000000000001',
    'push-dispatch',
    floor(extract(epoch from now()))::bigint
  ),
  true,
  'Taze UUID nonce ilk kullanımda atomik tüketilir'
);
select is(
  public.consume_push_worker_nonce(
    '40000000-0000-4000-8000-000000000001',
    'push-dispatch',
    floor(extract(epoch from now()))::bigint
  ),
  false,
  'Aynı UUID nonce replay edildiğinde reddedilir'
);
select is(
  public.consume_push_worker_nonce(
    '40000000-0000-4000-8000-000000000002',
    'push-receipts',
    floor(extract(epoch from now() - interval '6 minutes'))::bigint
  ),
  false,
  'Beş dakikalık pencerenin dışındaki worker isteği reddedilir'
);
select is(
  public.consume_push_worker_nonce(
    '40000000-0000-4000-8000-000000000003',
    'unscoped-worker',
    floor(extract(epoch from now()))::bigint
  ),
  false,
  'Allowlist dışındaki worker scope reddedilir'
);
select is(
  public.consume_push_worker_nonce(
    '40000000-0000-4000-8000-000000000004',
    'push-dispatch',
    9223372036854775807
  ),
  false,
  'Aşırı timestamp taşma üretmeden fail-closed reddedilir'
);

select ok(
  pg_get_functiondef('private.invoke_push_worker(text,jsonb)'::regprocedure)
    like '%x-push-worker-signature%'
  and pg_get_functiondef('private.invoke_push_worker(text,jsonb)'::regprocedure)
    like '%extensions.hmac%',
  'Internal worker çağrısı endpoint-scoped HMAC imzası üretir'
);
select ok(
  pg_get_functiondef('private.invoke_push_worker(text,jsonb)'::regprocedure)
    not like '%x-push-worker-secret%',
  'Raw worker secret HTTP header olarak taşınmaz'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.query_terminal_notification_delivery(uuid)',
    'EXECUTE'
  ),
  'Authenticated terminal teslimat sorgulayamaz'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.query_terminal_notification_delivery(uuid)',
    'EXECUTE'
  ),
  'Service role terminal teslimat sorgulayabilir'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replay_terminal_notification_delivery(uuid,uuid,text)',
    'EXECUTE'
  ),
  'Authenticated terminal teslimat replay edemez'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.replay_terminal_notification_delivery(uuid,uuid,text)',
    'EXECUTE'
  ),
  'Service role terminal teslimat replay edebilir'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.notification_delivery_replay_audit',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'Replay audit tablosu RPC dışında kapalıdır'
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
values (
  '40000000-0000-4000-8000-000000000040',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'push-hardening@etkinlink.test',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Push Hardening"}',
  now(),
  now()
);

update public.profiles
set username = 'push_hardening',
    birth_date = date '1990-01-01',
    gender = 'prefer_not_to_say',
    city = 'İstanbul',
    onboarding_completed = true,
    email_verified = true
where id = '40000000-0000-4000-8000-000000000040';

insert into public.push_tokens (
  id,
  user_id,
  expo_push_token,
  platform,
  project_id,
  disabled_at
)
values (
  '40000000-0000-4000-8000-000000000041',
  '40000000-0000-4000-8000-000000000040',
  'ExpoPushToken[push-hardening-test]',
  'android',
  '40000000-0000-4000-8000-000000000042',
  now()
), (
  '40000000-0000-4000-8000-000000000048',
  '40000000-0000-4000-8000-000000000040',
  'ExpoPushToken[push-hardening-active-test]',
  'android',
  '40000000-0000-4000-8000-000000000042',
  null
);

insert into public.notification_events (
  id,
  user_id,
  kind,
  title,
  body,
  channel_id,
  dedupe_key,
  delivery_status,
  attempt_count,
  last_error_code
)
values
  (
    '40000000-0000-4000-8000-000000000043',
    '40000000-0000-4000-8000-000000000040',
    'system',
    'Terminal test',
    'Terminal push delivery test',
    'system',
    'push-hardening-terminal',
    'cancelled',
    5,
    'MAX_ATTEMPTS_EXHAUSTED'
  ),
  (
    '40000000-0000-4000-8000-000000000044',
    '40000000-0000-4000-8000-000000000040',
    'system',
    'Pending test',
    'Pending push delivery test',
    'system',
    'push-hardening-pending',
    'pending',
    0,
    null
  ),
  (
    '40000000-0000-4000-8000-000000000049',
    '40000000-0000-4000-8000-000000000040',
    'system',
    'Invalid receipt test',
    'Atomic invalid-token persistence test',
    'system',
    'push-hardening-invalid-receipt',
    'sent',
    1,
    null
  );

insert into public.notification_deliveries (
  id,
  notification_event_id,
  push_token_id,
  status,
  error_code,
  receipt_status,
  receipt_attempt_count,
  receipt_checked_at,
  receipt_error_code
)
values (
  '40000000-0000-4000-8000-000000000045',
  '40000000-0000-4000-8000-000000000043',
  '40000000-0000-4000-8000-000000000041',
  'failed',
  'EXPO_PUSH_ERROR',
  'permanent_failure',
  5,
  now(),
  'MessageTooBig'
), (
  '40000000-0000-4000-8000-00000000004a',
  '40000000-0000-4000-8000-000000000044',
  '40000000-0000-4000-8000-000000000041',
  'failed',
  'MessageRateExceeded',
  null,
  1,
  null,
  null
), (
  '40000000-0000-4000-8000-000000000050',
  '40000000-0000-4000-8000-000000000049',
  '40000000-0000-4000-8000-000000000048',
  'sent',
  null,
  'pending',
  0,
  null,
  null
);

select is(
  public.persist_invalid_push_receipt(
    '40000000-0000-4000-8000-000000000050',
    0,
    'DeviceNotRegistered',
    'Expo token is no longer registered'
  ),
  true,
  'Invalid token ve terminal receipt tek atomik RPC ile kalıcılaştırılır'
);
select ok(
  (
    select disabled_at is not null
    from public.push_tokens
    where id = '40000000-0000-4000-8000-000000000048'
  ),
  'Atomik receipt RPC invalid push tokenı devre dışı bırakır'
);
select ok(
  (
    select receipt_status = 'invalid_token'
      and receipt_attempt_count = 1
      and receipt_checked_at is not null
      and receipt_next_attempt_at is null
    from public.notification_deliveries
    where id = '40000000-0000-4000-8000-000000000050'
  ),
  'Atomik receipt RPC teslimatı aynı transactionda terminal yapar'
);

select ok(
  (public.query_terminal_notification_delivery(
    '40000000-0000-4000-8000-000000000043'
  ) ->> 'isTerminal')::boolean,
  'Terminal push durumu teknik RPC ile sorgulanabilir'
);
select ok(
  not (
    public.query_terminal_notification_delivery(
      '40000000-0000-4000-8000-000000000043'
    ) ?| array['title', 'body', 'payload']
  ),
  'Terminal sorgu mesaj gövdesi veya payload sızdırmaz'
);

select is(
  public.replay_terminal_notification_delivery(
    '40000000-0000-4000-8000-000000000043',
    '40000000-0000-4000-8000-000000000046',
    'Operasyon incelemesi sonrası kontrollü yeniden deneme'
  ) ->> 'replayed',
  'true',
  'Terminal teslimat kontrollü biçimde replay kuyruğuna alınır'
);
select is(
  public.replay_terminal_notification_delivery(
    '40000000-0000-4000-8000-000000000043',
    '40000000-0000-4000-8000-000000000046',
    'Operasyon incelemesi sonrası kontrollü yeniden deneme'
  ) ->> 'auditId',
  (
    select response_payload ->> 'auditId'
    from private.notification_delivery_replay_audit
    where client_request_id = '40000000-0000-4000-8000-000000000046'
  ),
  'Aynı client request kimliği idempotent audit sonucunu döndürür'
);
select is(
  (
    select count(*)
    from private.notification_delivery_replay_audit
    where client_request_id = '40000000-0000-4000-8000-000000000046'
  ),
  1::bigint,
  'Idempotent replay tek immutable audit kaydı üretir'
);
select throws_ok(
  $$
    select public.replay_terminal_notification_delivery(
      '40000000-0000-4000-8000-000000000043',
      '40000000-0000-4000-8000-000000000046',
      'Aynı istek kimliği için farklı operasyon gerekçesi'
    )
  $$,
  '22023',
  'PUSH_REPLAY_IDEMPOTENCY_CONFLICT',
  'Replay idempotency aynı event için farklı reasonı reddeder'
);
select throws_ok(
  $$
    select public.replay_terminal_notification_delivery(
      '40000000-0000-4000-8000-000000000044',
      '40000000-0000-4000-8000-000000000046',
      'Operasyon incelemesi sonrası kontrollü yeniden deneme'
    )
  $$,
  '22023',
  'PUSH_REPLAY_IDEMPOTENCY_CONFLICT',
  'Replay idempotency aynı istek kimliğiyle farklı eventi reddeder'
);
select ok(
  (
    select disabled_at is not null
    from public.push_tokens
    where id = '40000000-0000-4000-8000-000000000041'
  ),
  'Terminal replay disabled tokenı yeniden etkinleştirmez'
);
select throws_ok(
  $$
    select public.replay_terminal_notification_delivery(
      '40000000-0000-4000-8000-000000000044',
      '40000000-0000-4000-8000-000000000047',
      'Terminal olmayan event için reddedilmesi gereken replay'
    )
  $$,
  '22023',
  'PUSH_REPLAY_NOT_TERMINAL',
  'Terminal olmayan event replay edilemez'
);
select throws_ok(
  $$
    update private.notification_delivery_replay_audit
    set reason = 'Audit kaydını değiştirme girişimi'
    where client_request_id = '40000000-0000-4000-8000-000000000046'
  $$,
  '42501',
  'Push replay audit kayıtları değiştirilemez.',
  'Replay audit kaydı immutable kalır'
);

select is(
  (select count(*) from cron.job where jobname = 'etkinlink-push-outbox-drain'),
  1::bigint,
  'Push outbox için tek scheduler bulunur'
);
select is(
  (select count(*) from cron.job where jobname = 'etkinlink-push-receipts'),
  1::bigint,
  'Push receipt için tek scheduler bulunur'
);

select * from finish();
rollback;

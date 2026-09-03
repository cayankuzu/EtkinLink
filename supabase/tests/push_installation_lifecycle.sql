begin;

create extension if not exists pgtap with schema extensions;
select plan(26);

select has_column(
  'public',
  'push_tokens',
  'installation_id',
  'Push token kalıcı installation ID taşır'
);
select has_column(
  'public',
  'push_tokens',
  'app_environment',
  'Push token uygulama ortamına bağlıdır'
);
select has_column(
  'public',
  'push_tokens',
  'token_expires_at',
  'Push token bounded server lease taşır'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass),
  'Push token tablosunda RLS açık kalır'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.sync_push_installation(text,text,uuid,uuid,text,text,text[])',
    'EXECUTE'
  ),
  'Anon installation sync çalıştıramaz'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.sync_push_installation(text,text,uuid,uuid,text,text,text[])',
    'EXECUTE'
  ),
  'Authenticated installation sync çalıştırabilir'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.revoke_push_installation(uuid,text,text,text)',
    'EXECUTE'
  ),
  'Anon installation tombstone oluşturamaz'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.revoke_push_installation(uuid,text,text,text)',
    'EXECUTE'
  ),
  'Authenticated kendi installation bağını iptal edebilir'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.revoke_push_installation(uuid,text,text,text)',
    'EXECUTE'
  ),
  'Service role owner-scoped client tombstone RPCsini doğrudan kullanamaz'
);
select ok(
  pg_get_indexdef(
    'public.notification_deliveries_receipt_claim_idx'::regclass
  ) like '%receipt_next_attempt_at, created_at, id%'
  and pg_get_indexdef(
    'public.notification_deliveries_receipt_claim_idx'::regclass
  ) like '%receipt_attempt_count < 5%',
  'Receipt claim sorgusuna eşleşen partial scheduling index vardır'
);
select ok(
  (
    select convalidated
    from pg_constraint
    where conrelid = 'public.notification_events'::regclass
      and conname = 'notification_events_kind'
  ),
  'Notification kind CHECK replacementı doğrulanmıştır'
);
select ok(
  pg_get_functiondef(
    'public.claim_notification_events(integer)'::regprocedure
  ) like '%token.token_expires_at > clock_timestamp()%',
  'Batch claim süresi dolmuş installation tokenlarını dışlar'
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
    '41000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'push-installation-a@etkinlink.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Push Installation A"}',
    now(),
    now()
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'push-installation-b@etkinlink.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Push Installation B"}',
    now(),
    now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$
    select public.sync_push_installation(
      'ExpoPushToken[installation-one]',
      'android',
      '41000000-0000-4000-8000-000000000010',
      '41000000-0000-4000-8000-000000000011',
      'preview',
      '1.0.9',
      '{}'::text[]
    )
  $$,
  'İlk installation bağı güvenle oluşturulur'
);

reset role;

select ok(
  (
    select user_id = '41000000-0000-4000-8000-000000000001'
      and installation_id = '41000000-0000-4000-8000-000000000011'
      and platform = 'android'
      and app_environment = 'preview'
      and token_expires_at > now() + interval '13 days 23 hours'
      and token_expires_at <= now() + interval '14 days 1 minute'
      and disabled_at is null
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[installation-one]'
  ),
  'Token user, installation, platform, environment ve bounded lease ile bağlıdır'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000001',
  true
);
select lives_ok(
  $$
    select public.sync_push_installation(
      'ExpoPushToken[installation-two]',
      'android',
      '41000000-0000-4000-8000-000000000010',
      '41000000-0000-4000-8000-000000000011',
      'preview',
      '1.0.9',
      array['ExpoPushToken[installation-one]']
    )
  $$,
  'Token rotation atomik installation sync ile tamamlanır'
);

reset role;

select ok(
  (
    select disabled_at is not null
      and revocation_reason = 'token_rotation'
      and token_expires_at <= clock_timestamp()
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[installation-one]'
  ),
  'Rotation eski tokenı tombstone yapar'
);
select is(
  (
    select count(*)
    from public.push_tokens
    where user_id = '41000000-0000-4000-8000-000000000001'
      and installation_id = '41000000-0000-4000-8000-000000000011'
      and app_environment = 'preview'
      and disabled_at is null
  ),
  1::bigint,
  'Bir user/installation/project/environment bağında yalnız bir aktif token kalır'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000002',
  true
);
select lives_ok(
  $$
    select public.sync_push_installation(
      'ExpoPushToken[installation-three]',
      'android',
      '41000000-0000-4000-8000-000000000010',
      '41000000-0000-4000-8000-000000000011',
      'preview',
      '1.0.9',
      array['ExpoPushToken[installation-two]']
    )
  $$,
  'Hesap değişimi önceki exact token kanıtıyla senkronize edilir'
);

reset role;

select ok(
  (
    select disabled_at is not null and revocation_reason = 'account_switch'
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[installation-two]'
  )
  and (
    select user_id = '41000000-0000-4000-8000-000000000002'
      and disabled_at is null
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[installation-three]'
  ),
  'Account switch eski hesabı tombstone yapıp yeni hesabı bağlar'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000002',
  true
);
select is(
  public.revoke_push_installation(
    '41000000-0000-4000-8000-000000000011',
    'preview',
    'ExpoPushToken[installation-three]',
    'logout'
  ),
  true,
  'Logout owner-scoped installation bağını iptal eder'
);

reset role;

select ok(
  (
    select disabled_at is not null and revocation_reason = 'logout'
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[installation-three]'
  ),
  'Logout tokenı kalıcı tombstone durumuna taşır'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '41000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $$
    select public.sync_push_installation(
      'ExpoPushToken[too-many-previous]',
      'android',
      '41000000-0000-4000-8000-000000000010',
      '41000000-0000-4000-8000-000000000011',
      'preview',
      '1.0.9',
      array[
        'ExpoPushToken[previous-one]',
        'ExpoPushToken[previous-two]',
        'ExpoPushToken[previous-three]'
      ]
    )
  $$,
  '22023',
  'Geçersiz önceki push token listesi.',
  'Offline rotation kurtarma listesi iki tokenla sınırlıdır'
);
select lives_ok(
  $$
    select public.sync_push_installation(
      'ExpoPushToken[reinstall-token]',
      'android',
      '41000000-0000-4000-8000-000000000010',
      '41000000-0000-4000-8000-000000000012',
      'preview',
      '1.0.9',
      '{}'::text[]
    )
  $$,
  'Reinstall yeni installation ID ile kaydolur'
);

reset role;

select ok(
  (
    select installation_id = '41000000-0000-4000-8000-000000000012'
      and user_id = '41000000-0000-4000-8000-000000000002'
      and disabled_at is null
    from public.push_tokens
    where expo_push_token = 'ExpoPushToken[reinstall-token]'
  ),
  'Reinstall önceki cihaz kimliğini yeniden kullanmaz'
);

update public.push_tokens
set token_expires_at = now() - interval '1 minute'
where expo_push_token = 'ExpoPushToken[reinstall-token]';

insert into public.notification_events (
  id,
  user_id,
  kind,
  title,
  body,
  channel_id,
  dedupe_key,
  delivery_status
)
values (
  '41000000-0000-4000-8000-000000000020',
  '41000000-0000-4000-8000-000000000002',
  'system',
  'Lease expiry test',
  'Expired token must not receive this message',
  'system',
  'push-installation-expired-token',
  'pending'
);

select is(
  jsonb_array_length(
    public.claim_notification_event(
      '41000000-0000-4000-8000-000000000020'
    ) -> 'tokens'
  ),
  0,
  'Süresi dolmuş token tekli claim sonucuna girmez'
);
select ok(
  (
    select delivery_status = 'cancelled'
      and last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
    from public.notification_events
    where id = '41000000-0000-4000-8000-000000000020'
  ),
  'Yalnız expired token varsa event güvenle iptal edilir'
);

select * from finish();
rollback;

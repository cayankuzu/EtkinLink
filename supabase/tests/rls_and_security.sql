begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'profiles', 'profile_photos', 'event_attendees', 'saved_events',
        'user_blocks', 'matches', 'direct_messages', 'room_messages',
        'push_tokens', 'notification_events', 'notification_deliveries'
      )
      and not c.relrowsecurity
  ),
  0::bigint,
  'Tüm hassas tablolar RLS kullanır'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  0::bigint,
  'SECURITY DEFINER fonksiyonları boş search_path ile sabitlenir'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'INSERT,UPDATE,DELETE'),
  'Anon profil yazamaz'
);

select ok(
  not has_table_privilege('anon', 'public.direct_messages', 'SELECT,INSERT,UPDATE,DELETE'),
  'Anon doğrudan mesajlara erişemez'
);

select ok(
  not has_table_privilege('anon', 'public.notification_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'Anon bildirim kuyruğuna erişemez'
);

select ok(
  to_regprocedure('public.is_email_available(text)') is null,
  'Anon e-posta hesap sorgulama RPC yüzeyi yoktur'
);

select ok(
  not has_function_privilege('anon', 'public.send_direct_message(uuid,text,uuid)', 'EXECUTE'),
  'Anon doğrudan mesaj RPC çağırmaz'
);

select ok(
  not has_function_privilege('anon', 'public.claim_notification_events(integer)', 'EXECUTE'),
  'Anon push kuyruğu claim edemez'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_notification_events(integer)', 'EXECUTE'),
  'Authenticated kullanıcı push kuyruğu claim edemez'
);

select ok(
  not has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT'),
  'Authenticated kullanıcı teslimat altyapısını okuyamaz'
);

select ok(
  has_function_privilege('service_role', 'public.claim_notification_events(integer)', 'EXECUTE'),
  'Yalnız service role batch push claim edebilir'
);

select ok(
  not has_function_privilege('authenticated', 'public.claim_pending_push_receipts(integer)', 'EXECUTE'),
  'Authenticated kullanıcı push receipt claim edemez'
);

select ok(
  has_function_privilege('service_role', 'public.claim_pending_push_receipts(integer)', 'EXECUTE'),
  'Yalnız service role push receipt claim edebilir'
);

select ok(
  not has_table_privilege('authenticated', 'auth.users', 'DELETE'),
  'Authenticated kullanıcı auth.users üzerinden hesap silemez'
);

select ok(
  not has_table_privilege('anon', 'auth.users', 'SELECT'),
  'Anon auth.users hesap varlığı bilgisini okuyamaz'
);

select ok(
  not has_table_privilege('authenticated', 'public.direct_messages', 'UPDATE,DELETE'),
  'Authenticated kullanıcı doğrudan mesaj tablolarını RPC dışında değiştiremez'
);

select is(
  (select public from storage.buckets where id = 'profile-photos'),
  false,
  'Profil fotoğrafı bucketı private kalır'
);

select like(
  coalesce(
    (
      select qual
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'profile_photo_storage_delete'
    ),
    ''
  ),
  '%auth.uid()%',
  'Storage silme politikası kullanıcı klasörüne bağlıdır'
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
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-a@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"RLS Kullanıcı A"}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-b@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"RLS Kullanıcı B"}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-c@etkinlink.test', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"RLS Kullanıcı C"}', now(), now()
  );

update public.profiles
set username = case id
      when '00000000-0000-4000-8000-000000000001' then 'rls_user_a'
      when '00000000-0000-4000-8000-000000000002' then 'rls_user_b'
      else 'rls_user_c'
    end,
    birth_date = date '1990-01-01',
    gender = 'prefer_not_to_say',
    city = 'İstanbul',
    onboarding_completed = true,
    email_verified = true
where id in (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003'
);

insert into public.events (
  id, source_guid, source_url, title, start_at, end_at, city
)
values (
  '10000000-0000-4000-8000-000000000001',
  'rls-test-event',
  'https://example.test/rls-event',
  'RLS Test Etkinliği',
  now() + interval '1 hour',
  now() + interval '3 hours',
  'İstanbul'
);

insert into public.event_attendees (event_id, user_id, status)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'joined'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'joined');

insert into public.matches (
  id, event_id, user1_id, user2_id, status
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'active'
);

insert into public.direct_messages (
  id, match_id, sender_id, receiver_id, body, client_message_id
)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'RLS özel mesaj',
  '30000000-0000-4000-8000-000000000002'
);

insert into public.direct_messages (
  match_id, sender_id, receiver_id, body, client_message_id
)
select
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  'RLS hız sınırı ' || sequence_number,
  gen_random_uuid()
from generate_series(1, 7) as sequence_number;

insert into public.room_messages (
  id, event_id, sender_id, body, client_message_id
)
values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'RLS oda mesajı',
  '40000000-0000-4000-8000-000000000002'
);

insert into public.room_messages (
  event_id, sender_id, body, client_message_id
)
select
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'RLS oda hız sınırı ' || sequence_number,
  gen_random_uuid()
from generate_series(1, 7) as sequence_number;

insert into public.event_likes (event_id, user_id, liked_user_id)
values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002'
);

select is(
  (
    select count(*)
    from public.notification_events
    where dedupe_key = 'direct-message:30000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'Doğrudan mesaj enqueue olayı dedupe anahtarıyla bir kez oluşur'
);

select is(
  (
    select count(*)
    from public.notification_events
    where dedupe_key =
      'room-message:40000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'Oda mesajı enqueue olayı alıcı başına bir kez oluşur'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.matches),
  1::bigint,
  'User A kendi eşleşmesini görür'
);
select is(
  (select count(*) from public.direct_messages),
  8::bigint,
  'User A kendi özel mesajını görür'
);
select is(
  (select count(*) from public.room_messages),
  8::bigint,
  'User A katıldığı odanın mesajını görür'
);

select lives_ok(
  $$
    select public.send_direct_message(
      '20000000-0000-4000-8000-000000000001',
      'RLS özel mesaj',
      '30000000-0000-4000-8000-000000000002'
    )
  $$,
  'Idempotent DM tekrarı hız limitine takılmaz'
);

select throws_ok(
  $$
    select public.send_direct_message(
      '20000000-0000-4000-8000-000000000001',
      'Dokuzuncu hızlı mesaj',
      '30000000-0000-4000-8000-000000000099'
    )
  $$,
  'P0001',
  'Bu sohbete çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.',
  'DM sohbet hız limiti dokuzuncu yazımı reddeder'
);

select lives_ok(
  $$
    select public.send_room_message(
      '10000000-0000-4000-8000-000000000001',
      'RLS oda mesajı',
      '40000000-0000-4000-8000-000000000002'
    )
  $$,
  'Idempotent oda mesajı tekrarı hız limitine takılmaz'
);

select throws_ok(
  $$
    select public.send_room_message(
      '10000000-0000-4000-8000-000000000001',
      'Dokuzuncu hızlı oda mesajı',
      '40000000-0000-4000-8000-000000000099'
    )
  $$,
  'P0001',
  'Bu sohbete çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.',
  'Oda sohbet hız limiti dokuzuncu yazımı reddeder'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.matches),
  0::bigint,
  'User C başka kullanıcıların eşleşmesini göremez'
);
select is(
  (select count(*) from public.direct_messages),
  0::bigint,
  'User C başka kullanıcıların özel mesajını göremez'
);
select is(
  (select count(*) from public.room_messages),
  0::bigint,
  'User C katılmadığı odanın mesajını göremez'
);
select is(
  (select count(*) from public.event_likes),
  0::bigint,
  'User C başka kullanıcının beğenisini göremez'
);

select lives_ok(
  $$ select public.delete_my_account() $$,
  'Kullanıcı kendi hesabını kontrollü SECURITY DEFINER sınırından silebilir'
);

reset role;
select is(
  (
    select count(*)
    from auth.users
    where id = '00000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'Hesap silme auth.users kaydını ve bağlı profili gerçekten kaldırır'
);

set local role service_role;
select is(
  (select count(*) from public.direct_messages),
  8::bigint,
  'Service role operasyonel özel mesaj erişimini korur'
);

reset role;
select * from finish();
rollback;

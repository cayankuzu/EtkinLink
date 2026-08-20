import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const required = [
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_PUBLISHABLE_KEY',
  'STAGING_SUPABASE_SERVICE_ROLE_KEY',
  'STAGING_E2E_EMAIL_DOMAIN',
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} eksik.`);
}
if (process.env.TARGET_ENV !== 'staging') {
  throw new Error('Kritik E2E yalnızca TARGET_ENV=staging ile çalışır.');
}

const url = process.env.STAGING_SUPABASE_URL;
const publishableKey = process.env.STAGING_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const runId = `${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
const password = `E2e-${crypto.randomUUID()}-Aa7`;
const emailA = `etkinlink-e2e-a-${runId}@${process.env.STAGING_E2E_EMAIL_DOMAIN}`;
const emailB = `etkinlink-e2e-b-${runId}@${process.env.STAGING_E2E_EMAIL_DOMAIN}`;
const admin = createClient(url, serviceRoleKey, authOptions());
const anonymous = createClient(url, publishableKey, authOptions());
const clientA = createClient(url, publishableKey, authOptions());
const clientB = createClient(url, publishableKey, authOptions());
const userIds = [];
let eventId = null;
const evidence = [];

function authOptions() {
  return { auth: { persistSession: false, autoRefreshToken: false } };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(step, details = {}) {
  evidence.push({
    step,
    status: 'passed',
    at: new Date().toISOString(),
    ...details,
  });
  console.log(`✓ ${step}`);
}

function requireResult(result, step) {
  if (result.error) throw new Error(`${step}: ${result.error.message}`);
  return result.data;
}

function profileMetadata(label, interestIds) {
  return {
    full_name: `E2E ${label}`,
    username: `e2e_${label.toLowerCase()}_${runId}`.slice(0, 24),
    birth_date: '1995-06-15',
    gender: label === 'A' ? 'woman' : 'man',
    bio: 'Staging kritik akış doğrulama profili.',
    city: 'İstanbul',
    interest_ids: interestIds,
  };
}

async function makeProfileReady(userId, label, interestIds) {
  requireResult(
    await admin
      .from('profiles')
      .update({ onboarding_completed: true, matching_enabled: true })
      .eq('id', userId),
    `${label} profilini tamamlama`,
  );
  requireResult(
    await admin.from('profile_photos').insert(
      [0, 1, 2].map(position => ({
        user_id: userId,
        position,
        storage_path: `${userId}/${crypto.randomUUID()}.jpg`,
      })),
    ),
    `${label} fotoğraf metadata hazırlığı`,
  );
  requireResult(
    await admin.from('user_interests').upsert(
      interestIds.map(interestId => ({
        user_id: userId,
        interest_id: interestId,
      })),
      { onConflict: 'user_id,interest_id' },
    ),
    `${label} ilgi alanı hazırlığı`,
  );
}

async function cleanup() {
  if (eventId) await admin.from('events').delete().eq('id', eventId);
  for (const userId of userIds) {
    await admin.auth.admin.deleteUser(userId, false);
  }
}

try {
  const interests = requireResult(
    await admin.from('interests').select('id').eq('is_active', true).limit(3),
    'İlgi alanlarını okuma',
  );
  assert(
    interests.length >= 3,
    'Staging üzerinde en az üç aktif ilgi alanı gerekli.',
  );
  const interestIds = interests.map(item => item.id);

  const signupA = requireResult(
    await clientA.auth.signUp({
      email: emailA,
      password,
      options: { data: profileMetadata('A', interestIds) },
    }),
    'Gerçek kayıt isteği',
  );
  assert(signupA.user?.id, 'Kayıt isteği kullanıcı kimliği döndürmedi.');
  userIds.push(signupA.user.id);
  requireResult(
    await admin.auth.admin.updateUserById(signupA.user.id, {
      email_confirm: true,
    }),
    'Kayıt doğrulaması',
  );
  pass('registration');

  const duplicateSignup = await anonymous.auth.signUp({
    email: emailA,
    password,
  });
  assert(
    !duplicateSignup.error,
    'Mevcut hesap için farklı/gözlemlenebilir signup hatası döndü.',
  );
  const availabilityProbe = await anonymous.rpc('is_email_available', {
    candidate_email: emailA,
  });
  assert(availabilityProbe.error, 'Anon e-posta varlık RPC erişimi hâlâ açık.');
  pass('account-existence-privacy');

  const createdB = requireResult(
    await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
      user_metadata: profileMetadata('B', interestIds),
    }),
    'İkinci test kullanıcısını hazırlama',
  );
  assert(createdB.user?.id, 'İkinci test kullanıcısı oluşturulamadı.');
  userIds.push(createdB.user.id);
  const userA = signupA.user.id;
  const userB = createdB.user.id;
  await makeProfileReady(userA, 'A', interestIds);
  await makeProfileReady(userB, 'B', interestIds);

  requireResult(
    await clientA.auth.signInWithPassword({ email: emailA, password }),
    'A login',
  );
  requireResult(
    await clientB.auth.signInWithPassword({ email: emailB, password }),
    'B login',
  );
  pass('login');

  const event = requireResult(
    await admin
      .from('events')
      .insert({
        source_guid: `staging-e2e-${runId}`,
        source_url: `https://example.com/etkinlink-e2e/${runId}`,
        title: `Staging E2E ${runId}`,
        start_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        end_at: new Date(Date.now() + 26 * 60 * 60_000).toISOString(),
        city: 'İstanbul',
        categories: ['Test'],
      })
      .select('id')
      .single(),
    'E2E etkinliğini hazırlama',
  );
  eventId = event.id;
  requireResult(
    await clientA.rpc('join_event', { target_event_id: eventId }),
    'A katılımı',
  );
  requireResult(
    await clientB.rpc('join_event', { target_event_id: eventId }),
    'B katılımı',
  );
  pass('event-attendance');

  requireResult(
    await clientA.rpc('send_room_message', {
      target_event_id: eventId,
      message_body: `E2E oda ${runId}`,
      client_message_id: crypto.randomUUID(),
    }),
    'Oda mesajı gönderme',
  );
  const roomMessages = requireResult(
    await clientB.rpc('list_room_messages', {
      target_event_id: eventId,
      page_size: 35,
      cursor_created_at: null,
      cursor_message_id: null,
    }),
    'Oda mesajını diğer kullanıcıyla okuma',
  );
  assert(
    JSON.stringify(roomMessages).includes(`E2E oda ${runId}`),
    'Oda mesajı okunamadı.',
  );
  pass('room-message');

  requireResult(
    await clientA.rpc('swipe_event_candidate_v2', {
      target_event_id: eventId,
      target_user_id: userB,
      action: 'like',
      request_id: crypto.randomUUID(),
    }),
    'A eşleşme beğenisi',
  );
  const matchingResult = requireResult(
    await clientB.rpc('swipe_event_candidate_v2', {
      target_event_id: eventId,
      target_user_id: userA,
      action: 'like',
      request_id: crypto.randomUUID(),
    }),
    'B eşleşme beğenisi',
  );
  const match = requireResult(
    await admin
      .from('matches')
      .select('id')
      .eq('event_id', eventId)
      .eq('user1_id', [userA, userB].sort()[0])
      .eq('user2_id', [userA, userB].sort()[1])
      .single(),
    'Oluşan eşleşmeyi doğrulama',
  );
  assert(
    matchingResult?.matched === true || matchingResult?.status === 'matched',
    'Karşılıklı beğeni eşleşme döndürmedi.',
  );
  pass('matching');

  const directMessage = requireResult(
    await clientA.rpc('send_direct_message', {
      target_match_id: match.id,
      message_body: `E2E özel mesaj ${runId}`,
      client_message_id: crypto.randomUUID(),
    }),
    'Özel mesaj gönderme',
  );
  const directMessages = requireResult(
    await clientB.rpc('list_direct_messages', {
      target_match_id: match.id,
      page_size: 40,
      cursor_created_at: null,
      cursor_message_id: null,
    }),
    'Özel mesajı diğer kullanıcıyla okuma',
  );
  assert(
    JSON.stringify(directMessages).includes(`E2E özel mesaj ${runId}`),
    'Özel mesaj okunamadı.',
  );
  pass('direct-message', { messageId: directMessage?.id ?? null });

  const pushEvent = requireResult(
    await admin
      .from('notification_events')
      .select('id,delivery_status')
      .eq('user_id', userB)
      .eq('kind', 'direct_message')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'DM push outbox kaydını okuma',
  );
  assert(pushEvent?.id, 'DM için durable push outbox olayı oluşmadı.');
  pass('push-enqueue', { deliveryStatus: pushEvent.delivery_status });

  const reportId = requireResult(
    await clientA.rpc('submit_report', {
      target_user_id: userB,
      reason: 'spam',
      details: 'Staging E2E rapor ve engelleme doğrulaması.',
      target_event_id: eventId,
      target_match_id: match.id,
      client_context: { source: 'staging-e2e' },
      block_after: true,
    }),
    'Rapor ve engelleme',
  );
  const block = requireResult(
    await admin
      .from('user_blocks')
      .select('blocker_id,blocked_id')
      .eq('blocker_id', userA)
      .eq('blocked_id', userB)
      .maybeSingle(),
    'Engelleme kaydını doğrulama',
  );
  assert(reportId && block, 'Rapor/engelleme zinciri tamamlanmadı.');
  pass('report-and-block');

  requireResult(
    await clientA.auth.signInWithPassword({ email: emailA, password }),
    'Silme öncesi taze login',
  );
  const deletion = await clientA.functions.invoke('delete-account', {
    body: {},
  });
  assert(
    !deletion.error && deletion.data?.deleted === true,
    'Hesap silme Edge Function başarısız.',
  );
  const deletedLookup = await admin.auth.admin.getUserById(userA);
  assert(deletedLookup.error, 'Silinen hesap Auth üzerinde hâlâ bulunuyor.');
  userIds.splice(userIds.indexOf(userA), 1);
  pass('account-deletion');

  mkdirSync(resolve('artifacts'), { recursive: true });
  writeFileSync(
    resolve('artifacts/staging-critical-e2e.json'),
    JSON.stringify({ runId, status: 'passed', evidence }, null, 2),
  );
} catch (error) {
  mkdirSync(resolve('artifacts'), { recursive: true });
  writeFileSync(
    resolve('artifacts/staging-critical-e2e.json'),
    JSON.stringify(
      {
        runId,
        status: 'failed',
        evidence,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await cleanup();
}

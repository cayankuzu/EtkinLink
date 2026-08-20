import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const androidBuild = read('android/app/build.gradle');
const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const appConfig = JSON.parse(read('app.json')).expo;
const iosInfo = read('ios/EtkinLink/Info.plist');
const privacyManifest = read('ios/EtkinLink/PrivacyInfo.xcprivacy');
const iosEntitlements = read('ios/EtkinLink/EtkinLink.entitlements');
const pushHardening = read(
  '../supabase/migrations/20260819100000_push_worker_hardening.sql',
);
const failures = [];

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find(value => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function requireArtifact(path, label, minimumBytes = 1) {
  if (!path) return;
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) {
    failures.push(`${label} bulunamadı: ${path}`);
    return;
  }
  if (statSync(absolutePath).size < minimumBytes) {
    failures.push(`${label} beklenen boyuttan küçük: ${path}`);
  }
}

if (
  androidBuild.includes(
    'release {\n            signingConfig signingConfigs.debug',
  )
) {
  failures.push('Android release debug anahtarı kullanıyor.');
}
if (!androidBuild.includes('shrinkResources enableProguardInReleaseBuilds')) {
  failures.push('Android resource shrinking kapalı.');
}
if (!androidManifest.includes('android:allowBackup="false"')) {
  failures.push('Android yedekleme kapısı kapalı değil.');
}
if (!androidManifest.includes('android:screenOrientation="portrait"')) {
  failures.push('Android telefon deneyimi portrait ile sınırlandırılmamış.');
}
if (
  !androidManifest.includes('android:scheme="etkinlink"') ||
  !androidManifest.includes('android:host="auth"')
) {
  failures.push('Android auth deep-link sözleşmesi eksik.');
}
for (const forbiddenPermission of [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
]) {
  if (androidManifest.includes(forbiddenPermission)) {
    failures.push(
      `Gereksiz Android izni kaynak manifestte bulundu: ${forbiddenPermission}`,
    );
  }
}
if (!iosInfo.includes('<string>etkinlink</string>')) {
  failures.push('iOS etkinlink URL scheme kaydı eksik.');
}
if (!iosInfo.includes('<key>NSPhotoLibraryUsageDescription</key>')) {
  failures.push('iOS fotoğraf izni açıklaması eksik.');
}
if (appConfig.ios?.supportsTablet !== false) {
  failures.push('Telefon odaklı sürümde iOS tablet desteği açık.');
}
if (
  appConfig.orientation !== 'portrait' ||
  appConfig.userInterfaceStyle !== 'light'
) {
  failures.push('Telefon portrait/light arayüz sözleşmesi bozulmuş.');
}
if (!privacyManifest.includes('NSPrivacyCollectedDataTypeName')) {
  failures.push('iOS Privacy Manifest veri envanteri boş.');
}
for (const requiredDataType of [
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeEmailsorTextMessages',
  'NSPrivacyCollectedDataTypeCrashData',
  'NSPrivacyCollectedDataTypePerformanceData',
]) {
  if (!privacyManifest.includes(requiredDataType)) {
    failures.push(`Privacy Manifest ${requiredDataType} beyanını içermiyor.`);
  }
}
if (!iosEntitlements.includes('<key>aps-environment</key>')) {
  failures.push('iOS kaynak entitlements dosyasında aps-environment eksik.');
}
if (
  !pushHardening.includes(
    "private.push_worker_setting('push_worker_secret')",
  ) ||
  !pushHardening.includes("'x-push-worker-secret', worker_secret")
) {
  failures.push('Push worker Vault/header zinciri eksik.');
}
if (
  /https:\/\/[\w-]+\.supabase\.co\/functions\/v1\/push-/u.test(pushHardening)
) {
  failures.push(
    'Push worker migration ortamdan bağımsız production URL içeriyor.',
  );
}
if (!appConfig.runtimeVersion || !appConfig.updates) {
  failures.push('OTA runtime/update politikası eksik.');
}
if (typeof appConfig.runtimeVersion !== 'string') {
  failures.push('Bare workflow runtimeVersion değeri açık bir string olmalı.');
}

const strict = process.argv.includes('--strict');
const platform = option('platform');
if (strict) {
  const requiredEnvironment = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
  ];
  if (!platform || platform === 'android') {
    requiredEnvironment.push(
      'ETKINLINK_UPLOAD_STORE_FILE',
      'ETKINLINK_UPLOAD_STORE_PASSWORD',
      'ETKINLINK_UPLOAD_KEY_ALIAS',
      'ETKINLINK_UPLOAD_KEY_PASSWORD',
    );
  }
  if (platform === 'ios') requiredEnvironment.push('EXPO_TOKEN');
  for (const key of requiredEnvironment) {
    if (!process.env[key]) failures.push(`Strict release için ${key} eksik.`);
  }
  if (
    process.env.SUPABASE_URL &&
    !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/u.test(process.env.SUPABASE_URL)
  ) {
    failures.push('Strict release için SUPABASE_URL güvenli değil.');
  }
  if (
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    !/^(sb_publishable_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.test(
      process.env.SUPABASE_PUBLISHABLE_KEY,
    )
  ) {
    failures.push('Strict release için publishable key biçimi geçersiz.');
  }
}

requireArtifact(option('android-artifact'), 'Signed AAB', 1_000_000);
requireArtifact(option('android-mapping'), 'Android R8 mapping', 100);
requireArtifact(option('ios-artifact'), 'Signed IPA', 1_000_000);
requireArtifact(option('ios-privacy'), 'IPA Privacy Manifest', 100);

const signedEntitlementsPath = option('ios-entitlements');
if (signedEntitlementsPath) {
  requireArtifact(signedEntitlementsPath, 'Signed iOS entitlements', 100);
  const absolutePath = resolve(root, signedEntitlementsPath);
  if (existsSync(absolutePath)) {
    const signedEntitlements = readFileSync(absolutePath, 'utf8');
    if (
      !signedEntitlements.includes('<key>aps-environment</key>') ||
      !signedEntitlements.includes('<string>production</string>')
    ) {
      failures.push('Signed IPA aps-environment=production içermiyor.');
    }
  }
}

if (failures.length) {
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(
  signedEntitlementsPath || option('android-artifact')
    ? 'Signed release artifact kapıları geçti.'
    : 'Statik release ön kapıları geçti; signed artifact kanıtı ayrıca zorunludur.',
);

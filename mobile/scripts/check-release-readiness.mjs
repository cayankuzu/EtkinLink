import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const androidBuild = read('android/app/build.gradle');
const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const androidStrings = read('android/app/src/main/res/values/strings.xml');
const appConfig = JSON.parse(read('app.json')).expo;
const easConfig = JSON.parse(read('eas.json'));
const iosInfo = read('ios/EtkinLink/Info.plist');
const iosExpo = read('ios/EtkinLink/Supporting/Expo.plist');
const iosProject = read('ios/EtkinLink.xcodeproj/project.pbxproj');
const privacyManifest = read('ios/EtkinLink/PrivacyInfo.xcprivacy');
const iosEntitlements = read('ios/EtkinLink/EtkinLink.entitlements');
const pushHardening = read(
  '../supabase/migrations/20260830140000_push_delivery_hardening.sql',
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
  !pushHardening.includes("'x-push-worker-timestamp'") ||
  !pushHardening.includes("'x-push-worker-nonce'") ||
  !pushHardening.includes("'x-push-worker-signature'") ||
  !pushHardening.includes('consume_push_worker_nonce') ||
  pushHardening.includes("'x-push-worker-secret'")
) {
  failures.push('Push worker scoped HMAC/Vault/nonce zinciri eksik.');
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
const expectedUpdateUrl =
  'https://u.expo.dev/a47f42fd-67ac-4f93-b6cd-8014abaa3e70';
const expectedRuntimeVersion = appConfig.version;
if (
  typeof appConfig.runtimeVersion !== 'string' ||
  appConfig.runtimeVersion !== expectedRuntimeVersion
) {
  failures.push(
    'Bare workflow runtimeVersion açık olmalı ve app version ile eşleşmeli.',
  );
}
if (
  appConfig.updates?.enabled !== true ||
  appConfig.updates?.url !== expectedUpdateUrl ||
  appConfig.updates?.checkAutomatically !== 'ON_LOAD' ||
  appConfig.updates?.fallbackToCacheTimeout !== 0
) {
  failures.push(
    'app.json OTA URL/launch politikası beklenen fail-safe değerlerde değil.',
  );
}
if (
  iosExpo.includes('<key>EXUpdatesEnabled</key>\n    <false/>') ||
  !iosExpo.includes('<key>EXUpdatesEnabled</key>\n    <true/>') ||
  !iosExpo.includes(`<string>${expectedUpdateUrl}</string>`) ||
  !iosExpo.includes(`<string>${expectedRuntimeVersion}</string>`)
) {
  failures.push(
    'iOS Expo.plist OTA URL/enabled/runtime değerleri app.json ile eşleşmiyor.',
  );
}
if (
  !iosProject.includes('Expo.plist in Resources') ||
  !iosProject.includes('EtkinLink/Supporting/Expo.plist')
) {
  failures.push('iOS Expo.plist uygulama bundle Resources fazına bağlı değil.');
}
if (
  !androidManifest.includes(
    'android:name="expo.modules.updates.EXPO_UPDATE_URL"',
  ) ||
  !androidManifest.includes(`android:value="${expectedUpdateUrl}"`) ||
  !androidManifest.includes(
    'android:name="expo.modules.updates.EXPO_RUNTIME_VERSION"',
  ) ||
  !androidManifest.includes('android:value="@string/expo_runtime_version"') ||
  !androidStrings.includes(
    `name="expo_runtime_version" translatable="false">${expectedRuntimeVersion}</string>`,
  )
) {
  failures.push(
    'Android Expo Updates URL/runtime metadata app.json ile eşleşmiyor.',
  );
}
const otaChannels = ['development', 'preview', 'production'].map(
  profile => easConfig.build?.[profile]?.channel,
);
if (
  otaChannels.some(channel => typeof channel !== 'string') ||
  new Set(otaChannels).size !== otaChannels.length
) {
  failures.push('EAS development/preview/production OTA kanalları ayrı değil.');
}

const strict = process.argv.includes('--strict');
const requireOtaSigning =
  strict || process.argv.includes('--require-ota-signing');
const platform = option('platform');

if (requireOtaSigning) {
  const certificateSetting = appConfig.updates?.codeSigningCertificate;
  const metadata = appConfig.updates?.codeSigningMetadata;
  if (
    typeof certificateSetting !== 'string' ||
    !certificateSetting.trim() ||
    metadata?.alg !== 'rsa-v1_5-sha256' ||
    typeof metadata?.keyid !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/u.test(metadata.keyid)
  ) {
    failures.push(
      'OTA code-signing certificate ve rsa-v1_5-sha256 key metadata app.json içinde eksik.',
    );
  } else {
    const certificatePath = resolve(root, certificateSetting);
    const repositoryRelative = relative(root, certificatePath)
      .split(sep)
      .join('/');
    if (
      !repositoryRelative ||
      repositoryRelative === '..' ||
      repositoryRelative.startsWith('../') ||
      !existsSync(certificatePath) ||
      lstatSync(certificatePath).isSymbolicLink() ||
      !statSync(certificatePath).isFile() ||
      statSync(certificatePath).size < 256
    ) {
      failures.push(
        'OTA public certificate mobile repository kökü içinde bulunamadı.',
      );
    } else {
      const certificate = readFileSync(certificatePath, 'utf8').trim();
      try {
        const parsedCertificate = new X509Certificate(certificate);
        const now = Date.now();
        if (
          parsedCertificate.publicKey.asymmetricKeyType !== 'rsa' ||
          (parsedCertificate.publicKey.asymmetricKeyDetails?.modulusLength ??
            0) < 2048 ||
          Date.parse(parsedCertificate.validFrom) > now ||
          Date.parse(parsedCertificate.validTo) <= now
        ) {
          failures.push(
            'OTA public certificate geçerli bir güncel RSA sertifikası değil.',
          );
        }
      } catch {
        failures.push(
          'OTA public certificate geçerli X.509 PEM biçiminde değil.',
        );
      }

      const normalizeCertificate = value =>
        value
          .replace(/&#(?:x0*[ad]|0*(?:10|13));/giu, '')
          .replaceAll('&quot;', '"')
          .replace(/\s+/gu, '');
      const normalizedCertificate = normalizeCertificate(certificate);
      const normalizedAndroid = normalizeCertificate(
        `${androidManifest}\n${androidStrings}`,
      );
      const normalizedIos = normalizeCertificate(iosExpo);
      if (
        !androidManifest.includes(
          'expo.modules.updates.CODE_SIGNING_CERTIFICATE',
        ) ||
        !androidManifest.includes(
          'expo.modules.updates.CODE_SIGNING_METADATA',
        ) ||
        !normalizedAndroid.includes(normalizedCertificate) ||
        !normalizedAndroid.includes(`"keyid":"${metadata.keyid}"`) ||
        !normalizedAndroid.includes('"alg":"rsa-v1_5-sha256"')
      ) {
        failures.push(
          'Android native Expo Updates code-signing certificate/metadata app.json ile eşleşmiyor.',
        );
      }
      if (
        !iosExpo.includes('<key>EXUpdatesCodeSigningCertificate</key>') ||
        !iosExpo.includes('<key>EXUpdatesCodeSigningMetadata</key>') ||
        !normalizedIos.includes(normalizedCertificate) ||
        !iosExpo.includes(`<string>${metadata.keyid}</string>`) ||
        !iosExpo.includes('<string>rsa-v1_5-sha256</string>')
      ) {
        failures.push(
          'iOS native Expo Updates code-signing certificate/metadata app.json ile eşleşmiyor.',
        );
      }
    }
  }
}

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
  if (process.env.EDGE_API_BASE_URL) {
    try {
      const edgeOrigin = new URL(process.env.EDGE_API_BASE_URL);
      if (
        edgeOrigin.protocol !== 'https:' ||
        edgeOrigin.origin !==
          process.env.EDGE_API_BASE_URL.replace(/\/$/u, '') ||
        edgeOrigin.pathname !== '/' ||
        edgeOrigin.search ||
        edgeOrigin.hash ||
        edgeOrigin.username ||
        edgeOrigin.password
      ) {
        failures.push(
          'Strict release için EDGE_API_BASE_URL çıplak HTTPS origin olmalı.',
        );
      }
    } catch {
      failures.push('Strict release için EDGE_API_BASE_URL geçersiz.');
    }
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

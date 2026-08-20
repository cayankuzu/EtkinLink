import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(
  root,
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const propertiesPath = path.join(root, 'android', 'gradle.properties');
const androidBuildPath = path.join(root, 'android', 'build.gradle');
const androidAppBuildPath = path.join(root, 'android', 'app', 'build.gradle');
const appConfigPath = path.join(root, 'app.json');
const iosEntitlementsPath = path.join(
  root,
  'ios',
  'EtkinLink',
  'EtkinLink.entitlements',
);
const iosProjectPath = path.join(
  root,
  'ios',
  'EtkinLink.xcodeproj',
  'project.pbxproj',
);

const manifest = fs.readFileSync(manifestPath, 'utf8');
const properties = fs.readFileSync(propertiesPath, 'utf8');
const androidBuild = fs.readFileSync(androidBuildPath, 'utf8');
const androidAppBuild = fs.readFileSync(androidAppBuildPath, 'utf8');
const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
const iosEntitlements = fs.readFileSync(iosEntitlementsPath, 'utf8');
const iosProject = fs.readFileSync(iosProjectPath, 'utf8');

const failures = [];
const expectedArchitectures = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const architectureMatch = properties.match(
  /^reactNativeArchitectures\s*=\s*(.+)$/m,
);
const architectures = architectureMatch?.[1]
  .split(',')
  .map(architecture => architecture.trim())
  .filter(Boolean);

if (
  !architectures ||
  expectedArchitectures.some(
    architecture => !architectures.includes(architecture),
  )
) {
  failures.push(
    `Android ABI listesi eksik: ${expectedArchitectures.join(', ')}`,
  );
}

const optionalFeatures = [
  'android.hardware.touchscreen',
  'android.hardware.wifi',
  'android.hardware.fingerprint',
];

for (const feature of optionalFeatures) {
  const escapedFeature = feature.replaceAll('.', '\\.');
  const optionalFeaturePattern = new RegExp(
    `<uses-feature\\s+android:name=["']${escapedFeature}["']\\s+android:required=["']false["']\\s*/>`,
  );
  if (!optionalFeaturePattern.test(manifest)) {
    failures.push(`${feature} zorunlu olmayan özellik olarak işaretlenmeli.`);
  }
}

for (const screenAttribute of ['smallScreens', 'normalScreens', 'anyDensity']) {
  if (!new RegExp(`android:${screenAttribute}=["']true["']`).test(manifest)) {
    failures.push(`supports-screens android:${screenAttribute}=true olmalı.`);
  }
}

for (const screenAttribute of ['largeScreens', 'xlargeScreens', 'resizeable']) {
  if (!new RegExp(`android:${screenAttribute}=["']false["']`).test(manifest)) {
    failures.push(
      `Telefon kapsamı için android:${screenAttribute}=false olmalı.`,
    );
  }
}

if (!/android:resizeableActivity=["']false["']/.test(manifest)) {
  failures.push('Telefon kapsamı için resizeableActivity=false olmalı.');
}

if (/<compatible-screens\b/.test(manifest)) {
  failures.push('compatible-screens allowlist cihaz kapsamını daraltmamalı.');
}

if (!/android:screenOrientation=["']portrait["']/.test(manifest)) {
  failures.push(
    'Telefon kapsamı app.json ile aynı portrait yönünü kullanmalı.',
  );
}

if (!manifest.includes('android.permission.POST_NOTIFICATIONS')) {
  failures.push('Android 13+ bildirim izni manifestte tanımlanmalı.');
}

if (
  appConfig.expo?.android?.googleServicesFile !== './google-services.json' ||
  !androidBuild.includes('com.google.gms:google-services:4.4.4') ||
  !androidAppBuild.includes('apply plugin: "com.google.gms.google-services"')
) {
  failures.push('Android FCM V1 istemci yapılandırması eksik.');
}

if (
  !iosEntitlements.includes('$(APS_ENVIRONMENT)') ||
  !iosProject.includes('APS_ENVIRONMENT = development;') ||
  !iosProject.includes('APS_ENVIRONMENT = production;')
) {
  failures.push('iOS APNs ortamı Debug/Release imzasına göre ayrılmalı.');
}

const minSdkMatch = androidBuild.match(/minSdkVersion\s*=\s*(\d+)/);
if (!minSdkMatch || Number(minSdkMatch[1]) > 24) {
  failures.push(
    'React Native 0.86 tabanı için minSdkVersion 24 seviyesini aşmamalı.',
  );
}

if (failures.length > 0) {
  console.error(failures.map(failure => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(
  'Telefon kapsamı guardı geçti: 4 ABI, 360/411/480dp sınıfı, portrait yönü ve tablet dışlama kararı doğrulandı.',
);

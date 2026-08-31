import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyFiles,
  GIT_DIFF_FILTER,
  parseNameStatusZ,
  UPDATE_CLASSIFICATIONS,
} from './classify-update.mjs';

test('JS, TS ve mevcut asset değişikliklerini OTA_SAFE sınıflandırır', () => {
  const result = classifyFiles([
    'mobile/src/features/events/eventService.ts',
    'mobile/src/assets/images/etkinlink-logo.png',
    'docs/ota-runtime-and-release.md',
  ]);
  assert.equal(result.classification, UPDATE_CLASSIFICATIONS.OTA_SAFE);
});

test('native veya dependency değişikliğinde native build ister', () => {
  for (const file of [
    'mobile/android/app/src/main/AndroidManifest.xml',
    'mobile/ios/EtkinLink/Info.plist',
    'mobile/package-lock.json',
    'mobile/app.json',
    'mobile/.env.production',
  ]) {
    assert.equal(
      classifyFiles([file]).classification,
      UPDATE_CLASSIFICATIONS.NATIVE_BUILD_REQUIRED,
      file,
    );
  }
});

test('bilinmeyen veya runtime değişikliği içermeyen diff fail-closed kalır', () => {
  assert.equal(
    classifyFiles(['mobile/unknown.runtime']).classification,
    UPDATE_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
  );
  assert.equal(
    classifyFiles(['docs/README.md']).classification,
    UPDATE_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
  );
  assert.equal(
    classifyFiles([]).classification,
    UPDATE_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
  );
  for (const file of [
    'mobile/src/test/setup.ts',
    'mobile/src/features/events/eventService.test.ts',
  ]) {
    assert.equal(
      classifyFiles([file]).classification,
      UPDATE_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
      file,
    );
  }
});

test('git diff filtresi silinen native dosyaları sınıflandırmadan çıkarmaz', () => {
  assert.match(GIT_DIFF_FILTER, /D/u);
});

test('NUL ayrımlı git diff rename için eski ve yeni yolları korur', () => {
  const files = parseNameStatusZ(
    'R100\0mobile/android/app/src/main/Legacy.kt\0mobile/src/Legacy.ts\0D\0mobile/ios/Legacy.swift\0',
  );
  assert.deepEqual(files, [
    'mobile/android/app/src/main/Legacy.kt',
    'mobile/src/Legacy.ts',
    'mobile/ios/Legacy.swift',
  ]);
  assert.equal(
    classifyFiles(files).classification,
    UPDATE_CLASSIFICATIONS.NATIVE_BUILD_REQUIRED,
  );
});

test('bozuk git name-status çıktısı fail-closed hata verir', () => {
  assert.throws(() => parseNameStatusZ('R100\0only-one-path\0'), /Eksik/u);
  assert.throws(() => parseNameStatusZ('Q\0path\0'), /Beklenmeyen/u);
});

test('runtime değişikliğiyle birlikte test değişiklikleri OTA_SAFE kalabilir', () => {
  const result = classifyFiles([
    'mobile/src/features/events/eventService.ts',
    'mobile/src/features/events/eventService.test.ts',
  ]);
  assert.equal(result.classification, UPDATE_CLASSIFICATIONS.OTA_SAFE);
  assert.deepEqual(result.otaFiles, [
    'mobile/src/features/events/eventService.ts',
  ]);
});

test('native sınıflandırması karışık diffte OTA sonucuna üstün gelir', () => {
  const result = classifyFiles([
    'mobile/src/App.tsx',
    'mobile/android/app/build.gradle',
    'unexpected/file.bin',
  ]);
  assert.equal(
    result.classification,
    UPDATE_CLASSIFICATIONS.NATIVE_BUILD_REQUIRED,
  );
});

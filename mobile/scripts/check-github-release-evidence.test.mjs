import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  inspectZipArchive,
  validateChecksummedArtifact,
  validateEasIosBuild,
} from './check-github-release-evidence.mjs';

const TARGET_SHA = '0123456789abcdef0123456789abcdef01234567';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '');
    const checksum = crc32(data);
    const flags = 0x0800;
    const mode = entry.mode ?? 0o100644;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode * 65_536) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function validChecksummedZip({ checksumOverride } = {}) {
  const metadata = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      targetSha: TARGET_SHA,
      runId: 123,
      runAttempt: 2,
      workflow: '.github/workflows/mobile-e2e.yml',
      job: 'backend-critical-flows',
    }),
  );
  const result = Buffer.from('{"ok":true}\n');
  const checksums = Buffer.from(
    checksumOverride ??
      `${sha256(metadata)}  metadata.json\n${sha256(result)}  result.json\n`,
  );
  return createStoredZip([
    { name: 'metadata.json', data: metadata },
    { name: 'result.json', data: result },
    { name: 'SHA256SUMS', data: checksums },
  ]);
}

test('bounded ZIP parser and SHA256SUMS verification accept exact valid evidence', () => {
  const archive = inspectZipArchive(validChecksummedZip(), {
    maxEntries: 3,
    maxTotalUncompressedBytes: 4_096,
    maxEntryUncompressedBytes: 2_048,
  });
  const result = validateChecksummedArtifact(archive, {
    checksumPath: 'SHA256SUMS',
    metadataPath: 'metadata.json',
    expectedMetadata: {
      schemaVersion: 1,
      targetSha: TARGET_SHA,
      runId: 123,
      runAttempt: 2,
      workflow: '.github/workflows/mobile-e2e.yml',
      job: 'backend-critical-flows',
    },
  });
  assert.equal(result.metadata.targetSha, TARGET_SHA);
  assert.match(result.contentDigests['result.json'], /^sha256:[0-9a-f]{64}$/u);
});

test('SHA256SUMS verification rejects a digest mismatch', () => {
  const archive = inspectZipArchive(
    validChecksummedZip({
      checksumOverride: `${'0'.repeat(64)}  metadata.json\n${'1'.repeat(
        64,
      )}  result.json\n`,
    }),
  );
  assert.throws(
    () =>
      validateChecksummedArtifact(archive, {
        checksumPath: 'SHA256SUMS',
        metadataPath: 'metadata.json',
        expectedMetadata: {},
      }),
    /digest uyusmazligi/u,
  );
});

test('ZIP parser rejects traversal and Windows-equivalent unsafe paths', () => {
  assert.throws(
    () =>
      inspectZipArchive(createStoredZip([{ name: '../escape', data: 'x' }])),
    /Guvenli olmayan ZIP yolu/u,
  );
  assert.throws(
    () =>
      inspectZipArchive(createStoredZip([{ name: 'C:/escape', data: 'x' }])),
    /Guvenli olmayan ZIP yolu/u,
  );
  assert.throws(
    () =>
      inspectZipArchive(createStoredZip([{ name: 'safe/NUL.txt', data: 'x' }])),
    /Guvenli olmayan ZIP yolu/u,
  );
  assert.throws(
    () =>
      inspectZipArchive(createStoredZip([{ name: 'trailing. ', data: 'x' }])),
    /Guvenli olmayan ZIP yolu/u,
  );
});

test('ZIP parser rejects symlinks and special Unix entries', () => {
  assert.throws(
    () =>
      inspectZipArchive(
        createStoredZip([{ name: 'link', data: 'target', mode: 0o120777 }]),
      ),
    /Symlink\/ozel ZIP entry/u,
  );
});

test('ZIP parser enforces entry count and total expanded byte bounds', () => {
  const zip = createStoredZip([
    { name: 'one.txt', data: '1234' },
    { name: 'two.txt', data: '5678' },
  ]);
  assert.throws(
    () => inspectZipArchive(zip, { maxEntries: 1 }),
    /entry limiti/u,
  );
  assert.throws(
    () => inspectZipArchive(zip, { maxTotalUncompressedBytes: 7 }),
    /toplam acilmis boyut/u,
  );
});

function validEasBuild() {
  return [
    {
      id: '4d5ea71b-5d80-4e8f-9207-2d9bf8b9ee21',
      status: 'FINISHED',
      platform: 'IOS',
      buildProfile: 'production',
      distribution: 'STORE',
      gitCommitHash: TARGET_SHA,
      isForIosSimulator: false,
      updateChannel: { id: 'channel-id', name: 'production' },
      artifacts: {
        buildUrl: 'https://expo.dev/artifacts/eas/example.ipa',
      },
    },
  ];
}

test('EAS iOS validator binds a finished store build to exact source SHA/profile/channel', () => {
  const build = validateEasIosBuild(validEasBuild(), { targetSha: TARGET_SHA });
  assert.equal(build.gitCommitHash, TARGET_SHA);
});

for (const [label, mutate] of [
  ['source SHA', build => (build.gitCommitHash = 'f'.repeat(40))],
  ['status', build => (build.status = 'ERRORED')],
  ['platform', build => (build.platform = 'ANDROID')],
  ['profile', build => (build.buildProfile = 'preview')],
  ['channel', build => (build.updateChannel.name = 'preview')],
  ['distribution', build => (build.distribution = 'INTERNAL')],
  ['simulator', build => (build.isForIosSimulator = true)],
]) {
  test(`EAS iOS validator fails closed for wrong ${label}`, () => {
    const payload = validEasBuild();
    mutate(payload[0]);
    assert.throws(() =>
      validateEasIosBuild(payload, { targetSha: TARGET_SHA }),
    );
  });
}

test('EAS iOS validator rejects ambiguous builds and legacy-only releaseChannel', () => {
  const build = validEasBuild()[0];
  delete build.updateChannel;
  build.releaseChannel = 'production';
  assert.throws(
    () => validateEasIosBuild([build], { targetSha: TARGET_SHA }),
    /updateChannel/u,
  );
  assert.throws(
    () => validateEasIosBuild([build, build], { targetSha: TARGET_SHA }),
    /exact bir build/u,
  );
});

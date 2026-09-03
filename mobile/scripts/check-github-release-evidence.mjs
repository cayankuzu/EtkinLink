import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const GITHUB_API_BASE = 'https://api.github.com';
const JSON_RESPONSE_LIMIT = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ZIP_SIGNATURES = {
  centralDirectory: 0x02014b50,
  endOfCentralDirectory: 0x06054b50,
  localFile: 0x04034b50,
};
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

const workflowRequirements = [
  {
    workflow: 'mobile-ci.yml',
    maxAgeDays: 7,
    allowedEvents: ['push'],
    artifacts: [
      {
        name: 'etkinlink-mobile-sbom',
        maxDownloadBytes: 20 * 1024 * 1024,
        maxEntries: 4,
        maxTotalUncompressedBytes: 40 * 1024 * 1024,
        exactFiles: ['mobile-sbom.cdx.json'],
        validate: validateSbomArtifact,
      },
      {
        name: 'local-database-security-evidence',
        maxDownloadBytes: 32 * 1024 * 1024,
        maxEntries: 8,
        maxTotalUncompressedBytes: 64 * 1024 * 1024,
        exactFiles: ['db-lint.txt', 'db-start.txt', 'pgtap.txt'],
        validate: validateNonemptyArtifact,
      },
      {
        name: 'etkinlink-debug-apk',
        maxDownloadBytes: 256 * 1024 * 1024,
        maxEntries: 4,
        maxTotalUncompressedBytes: 384 * 1024 * 1024,
        maxEntryUncompressedBytes: 384 * 1024 * 1024,
        exactFiles: ['app-debug.apk'],
        validate: validateApkArtifact,
      },
    ],
  },
  {
    workflow: 'mobile-e2e.yml',
    maxAgeDays: 7,
    allowedEvents: ['schedule', 'workflow_dispatch'],
    artifacts: [
      {
        name: 'android-maestro-evidence',
        maxDownloadBytes: 256 * 1024 * 1024,
        maxEntries: 2_048,
        maxTotalUncompressedBytes: 512 * 1024 * 1024,
        maxEntryUncompressedBytes: 128 * 1024 * 1024,
        validate: (archive, context) =>
          validateMaestroArtifact(archive, context),
      },
      {
        name: 'staging-critical-backend-e2e-evidence',
        maxDownloadBytes: 32 * 1024 * 1024,
        maxEntries: 8,
        maxTotalUncompressedBytes: 64 * 1024 * 1024,
        exactFiles: [
          'artifacts/e2e/backend-critical-flows/SHA256SUMS',
          'artifacts/e2e/backend-critical-flows/metadata.json',
          'mobile/artifacts/staging-critical-e2e.json',
        ],
        validate: (archive, context) =>
          validateChecksummedArtifact(archive, {
            checksumPath: 'artifacts/e2e/backend-critical-flows/SHA256SUMS',
            metadataPath: 'artifacts/e2e/backend-critical-flows/metadata.json',
            expectedMetadata: evidenceMetadata(context, {
              workflow: '.github/workflows/mobile-e2e.yml',
              job: 'backend-critical-flows',
            }),
          }),
      },
    ],
  },
  {
    workflow: 'staging-load-test.yml',
    maxAgeDays: 30,
    allowedEvents: ['workflow_dispatch'],
    artifacts: [
      {
        name: 'staging-mixed-load-evidence-10000vu',
        maxDownloadBytes: 32 * 1024 * 1024,
        maxEntries: 10,
        maxTotalUncompressedBytes: 64 * 1024 * 1024,
        exactFiles: [
          'SHA256SUMS',
          'load-evidence-metadata.json',
          'load-low-25vu.json',
          'load-medium-250vu.json',
          'load-target-10000vu.json',
        ],
        validate: (archive, context) =>
          validateChecksummedArtifact(archive, {
            checksumPath: 'SHA256SUMS',
            checksumPathPrefix: 'artifacts/',
            metadataPath: 'load-evidence-metadata.json',
            expectedMetadata: evidenceMetadata(context, {
              workflow: '.github/workflows/staging-load-test.yml',
              job: 'staged-load-test',
              targetVus: 10_000,
            }),
          }),
      },
    ],
  },
];

function fail(message) {
  throw new Error(message);
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    return fail(`${label} UTF-8 degil.`);
  }
}

function validateArchivePath(name, { directory = false } = {}) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 1_024 ||
    name.includes('\\') ||
    /[\0-\x1f\x7f]/u.test(name) ||
    name.startsWith('/') ||
    /^[a-zA-Z]:/u.test(name) ||
    name.includes(':')
  ) {
    fail(`Guvenli olmayan ZIP yolu: ${JSON.stringify(name)}.`);
  }
  const pathWithoutTrailingSlash = name.endsWith('/')
    ? name.slice(0, -1)
    : name;
  const segments = pathWithoutTrailingSlash.split('/');
  if (
    pathWithoutTrailingSlash.length === 0 ||
    segments.some(
      segment =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        /[. ]$/u.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment),
    )
  ) {
    fail(`Guvenli olmayan ZIP yolu: ${JSON.stringify(name)}.`);
  }
  if (directory !== name.endsWith('/')) {
    fail(`ZIP dizin isareti tutarsiz: ${JSON.stringify(name)}.`);
  }
  return name;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_SIGNATURES.endOfCentralDirectory) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  return fail('ZIP central-directory sonu bulunamadi.');
}

function readUInt32(buffer, offset, label) {
  if (offset < 0 || offset + 4 > buffer.length) fail(`${label} sinir disi.`);
  return buffer.readUInt32LE(offset);
}

function readUInt16(buffer, offset, label) {
  if (offset < 0 || offset + 2 > buffer.length) fail(`${label} sinir disi.`);
  return buffer.readUInt16LE(offset);
}

export function inspectZipArchive(
  buffer,
  {
    maxEntries = 2_048,
    maxTotalUncompressedBytes = 512 * 1024 * 1024,
    maxEntryUncompressedBytes = 256 * 1024 * 1024,
    maxCompressionRatio = 200,
  } = {},
) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    fail('Artifact gecerli bir ZIP buffer degil.');
  }
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = readUInt16(buffer, eocdOffset + 4, 'ZIP disk numarasi');
  const centralDisk = readUInt16(buffer, eocdOffset + 6, 'ZIP central disk');
  const entriesOnDisk = readUInt16(
    buffer,
    eocdOffset + 8,
    'ZIP disk entry sayisi',
  );
  const totalEntries = readUInt16(buffer, eocdOffset + 10, 'ZIP entry sayisi');
  const centralSize = readUInt32(buffer, eocdOffset + 12, 'ZIP central boyutu');
  const centralOffset = readUInt32(
    buffer,
    eocdOffset + 16,
    'ZIP central ofseti',
  );

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0 ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fail('Cok diskli, bos veya ZIP64 artifact kabul edilmez.');
  }
  if (totalEntries > maxEntries) {
    fail(`ZIP entry limiti asildi: ${totalEntries}/${maxEntries}.`);
  }
  if (
    centralSize > 8 * 1024 * 1024 ||
    centralOffset + centralSize !== eocdOffset
  ) {
    fail('ZIP central-directory boyutu/ofseti tutarsiz.');
  }

  const entries = [];
  const localSpans = [];
  const normalizedNames = new Set();
  let offset = centralOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (
      readUInt32(buffer, offset, 'ZIP central signature') !==
      ZIP_SIGNATURES.centralDirectory
    ) {
      fail(`ZIP central entry ${index} bozuk.`);
    }
    const versionMadeBy = readUInt16(buffer, offset + 4, 'ZIP version-made-by');
    const flags = readUInt16(buffer, offset + 8, 'ZIP flags');
    const compressionMethod = readUInt16(
      buffer,
      offset + 10,
      'ZIP compression',
    );
    const expectedCrc32 = readUInt32(buffer, offset + 16, 'ZIP CRC32');
    const compressedSize = readUInt32(
      buffer,
      offset + 20,
      'ZIP compressed size',
    );
    const uncompressedSize = readUInt32(
      buffer,
      offset + 24,
      'ZIP uncompressed size',
    );
    const fileNameLength = readUInt16(
      buffer,
      offset + 28,
      'ZIP filename length',
    );
    const extraLength = readUInt16(buffer, offset + 30, 'ZIP extra length');
    const commentLength = readUInt16(buffer, offset + 32, 'ZIP comment length');
    const diskStart = readUInt16(buffer, offset + 34, 'ZIP disk start');
    const externalAttributes = readUInt32(
      buffer,
      offset + 38,
      'ZIP external attributes',
    );
    const localHeaderOffset = readUInt32(
      buffer,
      offset + 42,
      'ZIP local offset',
    );
    const centralEntryEnd =
      offset + 46 + fileNameLength + extraLength + commentLength;

    if (
      centralEntryEnd > eocdOffset ||
      fileNameLength === 0 ||
      diskStart !== 0
    ) {
      fail(`ZIP central entry ${index} sinirlari bozuk.`);
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      fail('Sifreli ZIP entry kabul edilmez.');
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail(`Desteklenmeyen ZIP compression method: ${compressionMethod}.`);
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      fail('ZIP64 entry kabul edilmez.');
    }
    if (uncompressedSize > maxEntryUncompressedBytes) {
      fail('ZIP entry acilmis boyut limiti asildi.');
    }
    if (
      uncompressedSize > 0 &&
      compressedSize === 0 &&
      compressionMethod !== 0
    ) {
      fail('ZIP entry compression boyutu tutarsiz.');
    }
    if (
      compressedSize > 0 &&
      uncompressedSize / compressedSize > maxCompressionRatio
    ) {
      fail('ZIP entry compression orani limiti asildi.');
    }

    const rawName = buffer.subarray(offset + 46, offset + 46 + fileNameLength);
    const name = decodeUtf8(rawName, 'ZIP entry adi');
    const directory = name.endsWith('/');
    validateArchivePath(name, { directory });
    const collisionKey = name.normalize('NFC').toLocaleLowerCase('en-US');
    if (normalizedNames.has(collisionKey)) {
      fail(`Tekrarlanan/cakisan ZIP yolu: ${name}.`);
    }
    normalizedNames.add(collisionKey);

    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0o170000;
    if (
      (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) ||
      (externalAttributes & 0x400) !== 0
    ) {
      fail(`Symlink/ozel ZIP entry kabul edilmez: ${name}.`);
    }
    if (creatorSystem === 3 && fileType === 0o040000 && !directory) {
      fail(`ZIP Unix dizin modu yol ile tutarsiz: ${name}.`);
    }
    if (creatorSystem === 3 && fileType === 0o100000 && directory) {
      fail(`ZIP Unix dosya modu yol ile tutarsiz: ${name}.`);
    }
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      fail(`ZIP dizin entry boyutu sifir degil: ${name}.`);
    }

    if (
      readUInt32(buffer, localHeaderOffset, 'ZIP local signature') !==
      ZIP_SIGNATURES.localFile
    ) {
      fail(`ZIP local header bozuk: ${name}.`);
    }
    const localFlags = readUInt16(
      buffer,
      localHeaderOffset + 6,
      'ZIP local flags',
    );
    const localMethod = readUInt16(
      buffer,
      localHeaderOffset + 8,
      'ZIP local method',
    );
    const localNameLength = readUInt16(
      buffer,
      localHeaderOffset + 26,
      'ZIP local filename length',
    );
    const localExtraLength = readUInt16(
      buffer,
      localHeaderOffset + 28,
      'ZIP local extra length',
    );
    const dataOffset =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const localName = buffer.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localNameLength,
    );
    if (
      !localName.equals(rawName) ||
      localFlags !== flags ||
      localMethod !== compressionMethod ||
      dataOffset + compressedSize > centralOffset
    ) {
      fail(`ZIP local/central entry tutarsiz: ${name}.`);
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maxTotalUncompressedBytes) {
      fail('ZIP toplam acilmis boyut limiti asildi.');
    }
    entries.push({
      name,
      directory,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      expectedCrc32,
      dataOffset,
    });
    localSpans.push({
      start: localHeaderOffset,
      end: dataOffset + compressedSize,
    });
    offset = centralEntryEnd;
  }
  if (offset !== eocdOffset)
    fail('ZIP central-directory entry sayisi tutarsiz.');
  localSpans.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localSpans.length; index += 1) {
    if (localSpans[index - 1].end > localSpans[index].start) {
      fail('ZIP local entry araliklari cakisir.');
    }
  }

  return {
    buffer,
    entries,
    totalUncompressedBytes,
    read(entryName) {
      const entry = entries.find(candidate => candidate.name === entryName);
      if (!entry || entry.directory)
        fail(`ZIP dosyasi bulunamadi: ${entryName}.`);
      const compressed = buffer.subarray(
        entry.dataOffset,
        entry.dataOffset + entry.compressedSize,
      );
      let uncompressed;
      try {
        uncompressed =
          entry.compressionMethod === 0
            ? Buffer.from(compressed)
            : inflateRawSync(compressed, {
                maxOutputLength: entry.uncompressedSize + 1,
              });
      } catch {
        return fail(`ZIP entry acilamadi: ${entryName}.`);
      }
      if (
        uncompressed.length !== entry.uncompressedSize ||
        crc32(uncompressed) !== entry.expectedCrc32
      ) {
        fail(`ZIP entry boyut/CRC dogrulamasi basarisiz: ${entryName}.`);
      }
      return uncompressed;
    },
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function artifactFiles(archive) {
  return archive.entries
    .filter(entry => !entry.directory)
    .map(entry => entry.name)
    .sort();
}

function requireExactFiles(archive, exactFiles) {
  const actual = artifactFiles(archive);
  const expected = [...exactFiles].sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    fail(`Artifact dosya seti exact degil. Beklenen=${expected.join(',')}.`);
  }
}

function contentDigests(archive) {
  return Object.fromEntries(
    artifactFiles(archive).map(name => [
      name,
      `sha256:${sha256(archive.read(name))}`,
    ]),
  );
}

function parseJsonEntry(archive, path) {
  const bytes = archive.read(path);
  let value;
  try {
    value = JSON.parse(decodeUtf8(bytes, path));
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${path} gecerli JSON degil.`);
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${path} JSON object olmali.`);
  }
  return value;
}

function validateSbomArtifact(archive) {
  const sbom = parseJsonEntry(archive, 'mobile-sbom.cdx.json');
  if (
    sbom.bomFormat !== 'CycloneDX' ||
    typeof sbom.specVersion !== 'string' ||
    !Array.isArray(sbom.components)
  ) {
    fail('Mobil SBOM CycloneDX sozlesmesine uymuyor.');
  }
  return { contentDigests: contentDigests(archive) };
}

function validateApkArtifact(archive) {
  const apk = archive.read('app-debug.apk');
  if (apk.length < 4 || apk.readUInt32LE(0) !== ZIP_SIGNATURES.localFile) {
    fail('Debug APK gecerli ZIP/APK imzasi tasimiyor.');
  }
  return { contentDigests: { 'app-debug.apk': `sha256:${sha256(apk)}` } };
}

function validateNonemptyArtifact(archive) {
  const digests = {};
  for (const name of artifactFiles(archive)) {
    const bytes = archive.read(name);
    if (bytes.length === 0) fail(`Bos kanit dosyasi: ${name}.`);
    digests[name] = `sha256:${sha256(bytes)}`;
  }
  return { contentDigests: digests };
}

function evidenceMetadata(context, extra) {
  return {
    schemaVersion: 1,
    targetSha: context.targetSha,
    runId: context.run.id,
    runAttempt: context.run.run_attempt,
    ...extra,
  };
}

function requireExactObjectFields(actual, expected, label) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (actual[key] !== expectedValue) {
      fail(`${label}.${key} exact kanit bagina uymuyor.`);
    }
  }
}

export function validateChecksummedArtifact(
  archive,
  { checksumPath, checksumPathPrefix = '', metadataPath, expectedMetadata },
) {
  const checksumBytes = archive.read(checksumPath);
  const checksumText = decodeUtf8(checksumBytes, checksumPath);
  const lines = checksumText.split(/\r?\n/u).filter(line => line.length > 0);
  if (lines.length === 0) fail(`${checksumPath} bos.`);

  const expectedTargets = new Set(
    artifactFiles(archive).filter(path => path !== checksumPath),
  );
  const verifiedTargets = new Set();
  const digests = { [checksumPath]: `sha256:${sha256(checksumBytes)}` };

  for (const line of lines) {
    const match = /^([0-9a-f]{64}) ([ *])(.+)$/u.exec(line);
    if (!match)
      fail(`${checksumPath} satiri canonical sha256sum biciminde degil.`);
    const [, expectedDigest, , checksumTarget] = match;
    validateArchivePath(checksumTarget);
    const archiveTarget = checksumPathPrefix
      ? checksumTarget.startsWith(checksumPathPrefix)
        ? checksumTarget.slice(checksumPathPrefix.length)
        : fail(`${checksumPath} hedef prefix'i exact degil.`)
      : checksumTarget;
    if (
      archiveTarget === checksumPath ||
      !expectedTargets.has(archiveTarget) ||
      verifiedTargets.has(archiveTarget)
    ) {
      fail(`${checksumPath} hedef seti gecersiz: ${checksumTarget}.`);
    }
    const actualDigest = sha256(archive.read(archiveTarget));
    if (actualDigest !== expectedDigest) {
      fail(`${checksumPath} digest uyusmazligi: ${checksumTarget}.`);
    }
    verifiedTargets.add(archiveTarget);
    digests[archiveTarget] = `sha256:${actualDigest}`;
  }
  if (
    verifiedTargets.size !== expectedTargets.size ||
    [...expectedTargets].some(path => !verifiedTargets.has(path))
  ) {
    fail(`${checksumPath} tum artifact dosyalarini exact kapsamiyor.`);
  }

  const metadata = parseJsonEntry(archive, metadataPath);
  requireExactObjectFields(metadata, expectedMetadata, metadataPath);
  return { contentDigests: digests, metadata };
}

function validateMaestroArtifact(archive, context) {
  const required = [
    'artifacts/e2e/android-maestro/SHA256SUMS',
    'artifacts/e2e/android-maestro/metadata.json',
    'mobile/e2e-results.xml',
  ];
  const files = artifactFiles(archive);
  for (const path of required) {
    if (!files.includes(path)) fail(`Maestro artifact dosyasi eksik: ${path}.`);
  }
  for (const path of files) {
    if (!required.includes(path) && !path.startsWith('mobile/e2e-debug/')) {
      fail(`Maestro artifact dosya seti exact degil: ${path}.`);
    }
  }
  if (!files.some(path => path.startsWith('mobile/e2e-debug/'))) {
    fail('Maestro artifact en az bir debug kanit dosyasi icermeli.');
  }
  const junit = decodeUtf8(
    archive.read('mobile/e2e-results.xml'),
    'Maestro JUnit',
  );
  if (!/<testsuites?\b/u.test(junit)) fail('Maestro JUnit sonucu gecersiz.');
  return validateChecksummedArtifact(archive, {
    checksumPath: 'artifacts/e2e/android-maestro/SHA256SUMS',
    metadataPath: 'artifacts/e2e/android-maestro/metadata.json',
    expectedMetadata: evidenceMetadata(context, {
      workflow: '.github/workflows/mobile-e2e.yml',
      job: 'android-maestro',
    }),
  });
}

export function validateEasIosBuild(payload, { targetSha }) {
  if (!/^[0-9a-f]{40}$/u.test(targetSha ?? '')) {
    fail('EAS iOS TARGET_SHA exact 40 karakter kucuk harf commit SHA olmali.');
  }
  if (!Array.isArray(payload) || payload.length !== 1) {
    fail('EAS iOS build JSON exact bir build icermeli.');
  }
  const build = payload[0];
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    fail('EAS iOS build kaydi object olmali.');
  }
  const expected = {
    status: 'FINISHED',
    platform: 'IOS',
    buildProfile: 'production',
    distribution: 'STORE',
    gitCommitHash: targetSha,
    isForIosSimulator: false,
  };
  requireExactObjectFields(build, expected, 'EAS build');
  if (build.updateChannel?.name !== 'production') {
    fail('EAS build updateChannel.name exact production olmali.');
  }
  if (typeof build.id !== 'string' || build.id.length < 8) {
    fail('EAS build id eksik/gecersiz.');
  }
  const buildUrl = build.artifacts?.buildUrl;
  let parsedUrl;
  try {
    parsedUrl = new URL(buildUrl);
  } catch {
    return fail('EAS build artifact URL eksik/gecersiz.');
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    (parsedUrl.hostname !== 'expo.dev' &&
      !parsedUrl.hostname.endsWith('.expo.dev'))
  ) {
    fail('EAS build artifact URL guvenilir HTTPS Expo origin olmali.');
  }
  return build;
}

async function readBoundedResponse(
  response,
  maxBytes,
  label,
  { allowContentEncoding = false, requireExactContentLength = true } = {},
) {
  const contentEncoding = response.headers.get('content-encoding');
  if (
    !allowContentEncoding &&
    contentEncoding &&
    contentEncoding !== 'identity'
  ) {
    fail(`${label} beklenmeyen HTTP content-encoding kullaniyor.`);
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && !/^\d+$/u.test(declaredLength)) {
    fail(`${label} content-length gecersiz.`);
  }
  if (declaredLength && Number(declaredLength) > maxBytes) {
    fail(`${label} indirme boyut limiti asildi.`);
  }
  if (!response.body) fail(`${label} response body eksik.`);
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > maxBytes) fail(`${label} indirme boyut limiti asildi.`);
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('boyut limiti')) {
      throw error;
    }
    return fail(`${label} stream ag/zaman asimi hatasi verdi.`);
  }
  if (
    requireExactContentLength &&
    declaredLength &&
    Number(declaredLength) !== total
  ) {
    fail(`${label} content-length ile indirilen boyut uyusmuyor.`);
  }
  return Buffer.concat(chunks, total);
}

async function githubJson(path, headers, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return fail('GitHub evidence sorgusu ag/zaman asimi hatasi verdi.');
  }
  if (!response.ok) {
    fail(`GitHub evidence sorgusu HTTP ${response.status}.`);
  }
  const body = await readBoundedResponse(
    response,
    JSON_RESPONSE_LIMIT,
    'GitHub JSON response',
    { allowContentEncoding: true, requireExactContentLength: false },
  );
  try {
    return JSON.parse(decodeUtf8(body, 'GitHub JSON response'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('GitHub JSON response gecersiz.');
    throw error;
  }
}

async function downloadArtifact(
  artifact,
  requirement,
  headers,
  fetchImpl = fetch,
) {
  let url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(
    artifact.owner,
  )}/${encodeURIComponent(artifact.repository)}/actions/artifacts/${
    artifact.id
  }/zip`;
  let requestHeaders = headers;
  let response;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    try {
      response = await fetchImpl(url, {
        headers: requestHeaders,
        redirect: 'manual',
        signal: AbortSignal.timeout(900_000),
      });
    } catch {
      return fail('GitHub artifact indirme ag/zaman asimi hatasi verdi.');
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirectCount === MAX_REDIRECTS)
      fail('Artifact redirect limiti asildi.');
    const location = response.headers.get('location');
    let next;
    try {
      next = new URL(location, url);
    } catch {
      return fail('Artifact redirect URL gecersiz.');
    }
    if (next.protocol !== 'https:' || next.username || next.password) {
      fail('Artifact redirect yalniz guvenli HTTPS olabilir.');
    }
    await response.body?.cancel();
    url = next.href;
    requestHeaders = undefined;
  }
  if (!response?.ok)
    fail(`GitHub artifact indirme HTTP ${response?.status ?? 0}.`);
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    !['application/zip', 'application/octet-stream'].includes(contentType ?? '')
  ) {
    fail('GitHub artifact content-type ZIP degil.');
  }
  const buffer = await readBoundedResponse(
    response,
    requirement.maxDownloadBytes,
    `GitHub artifact ${artifact.name}`,
  );
  if (buffer.length !== artifact.size_in_bytes) {
    fail(`GitHub artifact ${artifact.name} API/indirme boyutu uyusmuyor.`);
  }
  const downloadedDigest = `sha256:${sha256(buffer)}`;
  if (!/^sha256:[0-9a-f]{64}$/u.test(artifact.digest ?? '')) {
    fail(`GitHub artifact ${artifact.name} API digest'i eksik/gecersiz.`);
  }
  if (downloadedDigest !== artifact.digest) {
    fail(`GitHub artifact ${artifact.name} archive digest'i uyusmuyor.`);
  }
  return { buffer, downloadedDigest };
}

function validateTargetSha(targetSha) {
  if (!targetSha || !/^[0-9a-f]{40}$/u.test(targetSha)) {
    fail('TARGET_SHA exact 40 karakter kucuk harf commit SHA olmali.');
  }
  return targetSha;
}

async function collectReleaseEvidence({ token, repository, targetSha }) {
  if (!token) fail('GITHUB_TOKEN eksik.');
  const repositoryParts = repository?.split('/') ?? [];
  if (repositoryParts.length !== 2 || repositoryParts.some(part => !part)) {
    fail('GITHUB_REPOSITORY owner/repository biciminde olmali.');
  }
  const [owner, repositoryName] = repositoryParts;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const evidence = [];

  for (const requirement of workflowRequirements) {
    const workflowPath = encodeURIComponent(requirement.workflow);
    const runsPayload = await githubJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repositoryName,
      )}/actions/workflows/${workflowPath}/runs?status=completed&per_page=30`,
      headers,
    );
    const earliest = Date.now() - requirement.maxAgeDays * 24 * 60 * 60_000;
    const run = runsPayload.workflow_runs?.find(candidate => {
      const completedAt = new Date(candidate.updated_at).getTime();
      return (
        candidate.status === 'completed' &&
        candidate.conclusion === 'success' &&
        candidate.head_sha === targetSha &&
        candidate.head_repository?.full_name === repository &&
        Number.isFinite(completedAt) &&
        completedAt >= earliest &&
        requirement.allowedEvents.includes(candidate.event) &&
        isPositiveSafeInteger(candidate.id) &&
        isPositiveSafeInteger(candidate.run_attempt)
      );
    });
    if (!run) {
      fail(
        `${requirement.workflow} icin ${requirement.maxAgeDays} gun icinde ayni SHA'ya bagli uygun basarili run yok.`,
      );
    }

    const artifactPayload = await githubJson(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repositoryName,
      )}/actions/runs/${run.id}/artifacts?per_page=100`,
      headers,
    );
    const runArtifacts = artifactPayload.artifacts ?? [];
    const verifiedArtifacts = [];
    for (const artifactRequirement of requirement.artifacts) {
      const matches = runArtifacts.filter(
        artifact => artifact.name === artifactRequirement.name,
      );
      if (matches.length !== 1) {
        fail(
          `${requirement.workflow} run ${run.id} exact bir ${artifactRequirement.name} artifact'i icermeli.`,
        );
      }
      const artifact = matches[0];
      if (
        artifact.expired ||
        !isPositiveSafeInteger(artifact.id) ||
        !isPositiveSafeInteger(artifact.size_in_bytes) ||
        artifact.size_in_bytes > artifactRequirement.maxDownloadBytes ||
        artifact.workflow_run?.id !== run.id ||
        artifact.workflow_run?.head_sha !== targetSha ||
        artifact.workflow_run?.repository_id !== run.repository?.id ||
        artifact.workflow_run?.head_repository_id !== run.head_repository?.id
      ) {
        fail(
          `${artifactRequirement.name} API identity/boyut baglantisi gecersiz.`,
        );
      }
      console.log(`${artifactRequirement.name} archive/digest dogrulaniyor...`);
      const { buffer, downloadedDigest } = await downloadArtifact(
        { ...artifact, owner, repository: repositoryName },
        artifactRequirement,
        headers,
      );
      const archive = inspectZipArchive(buffer, {
        maxEntries: artifactRequirement.maxEntries,
        maxTotalUncompressedBytes:
          artifactRequirement.maxTotalUncompressedBytes,
        maxEntryUncompressedBytes:
          artifactRequirement.maxEntryUncompressedBytes,
      });
      if (artifactRequirement.exactFiles) {
        requireExactFiles(archive, artifactRequirement.exactFiles);
      }
      const validation = artifactRequirement.validate(archive, {
        run,
        targetSha,
      });
      verifiedArtifacts.push({
        id: artifact.id,
        name: artifact.name,
        archiveDigest: downloadedDigest,
        archiveBytes: buffer.length,
        uncompressedBytes: archive.totalUncompressedBytes,
        files: artifactFiles(archive),
        ...validation,
      });
    }
    evidence.push({
      workflow: requirement.workflow,
      runId: run.id,
      runUrl: run.html_url,
      headSha: run.head_sha,
      completedAt: run.updated_at,
      runAttempt: run.run_attempt,
      event: run.event,
      artifacts: verifiedArtifacts,
    });
  }
  return evidence;
}

async function runReleaseEvidenceCheck() {
  const targetSha = validateTargetSha(
    process.env.TARGET_SHA || process.env.GITHUB_SHA,
  );
  if (process.env.TARGET_SHA && process.env.GITHUB_SHA !== targetSha) {
    fail('Workflow ref SHA ile explicit TARGET_SHA ayni olmali.');
  }
  const evidence = await collectReleaseEvidence({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    targetSha,
  });
  const artifactDirectory = resolve(import.meta.dirname, '../../artifacts');
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(
    resolve(artifactDirectory, 'release-prerequisite-evidence.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        checkedAt: new Date().toISOString(),
        commit: targetSha,
        evidence,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  console.log(
    'CI, staging E2E ve 10K yuk artifact icerikleri/checksumlari ayni SHA icin dogrulandi.',
  );
}

function argumentValue(prefix) {
  const argument = process.argv
    .slice(2)
    .find(value => value.startsWith(prefix));
  return argument?.slice(prefix.length);
}

async function main() {
  const easBuildPath = argumentValue('--validate-eas-ios-build=');
  if (easBuildPath) {
    const { readFileSync } = await import('node:fs');
    let payload;
    try {
      payload = JSON.parse(readFileSync(resolve(easBuildPath), 'utf8'));
    } catch {
      return fail('EAS iOS build JSON okunamadi/gecersiz.');
    }
    const build = validateEasIosBuild(payload, {
      targetSha: validateTargetSha(
        argumentValue('--target-sha=') || process.env.TARGET_SHA,
      ),
    });
    process.stdout.write(build.artifacts.buildUrl);
    return;
  }
  await runReleaseEvidenceCheck();
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();

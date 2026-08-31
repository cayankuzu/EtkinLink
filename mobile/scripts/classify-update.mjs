import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const UPDATE_CLASSIFICATIONS = Object.freeze({
  OTA_SAFE: 'OTA_SAFE',
  NATIVE_BUILD_REQUIRED: 'NATIVE_BUILD_REQUIRED',
  MANUAL_REVIEW_REQUIRED: 'MANUAL_REVIEW_REQUIRED',
});

export const GIT_DIFF_FILTER = 'ACDMRTUXB';
const GIT_STATUS_PATTERN = /^[ACDMRTUXB][0-9]*$/u;

const nativePatterns = [
  /^mobile\/(?:android|ios)\//u,
  /^mobile\/(?:app\.json|app\.config\.[^/]+|eas\.json)$/u,
  /^mobile\/(?:package(?:-lock)?|npm-shrinkwrap)\.json$/u,
  /^mobile\/(?:Podfile|Gemfile)(?:\.lock)?$/u,
  /^mobile\/(?:babel|metro|react-native)\.config\.[^/]+$/u,
  /^mobile\/(?:patches|plugins)\//u,
  /^mobile\/\.env(?:\.|$)/u,
];

const otaSourcePatterns = [
  /^mobile\/index\.(?:js|jsx|ts|tsx)$/u,
  /^mobile\/src\/.*\.(?:js|jsx|ts|tsx|json|png|jpe?g|webp|gif|svg|ttf|otf)$/u,
];

const nonRuntimePatterns = [
  /^(?:\.github|docs|quality|release-evidence|scripts|supabase|infra)\//u,
  /^mobile\/(?:README\.md|docs|coverage)\//u,
  /^mobile\/README\.md$/u,
  /^mobile\/(?:__tests__|src\/test)\//u,
  /^mobile\/src\/.*\.(?:test|spec)\.(?:js|jsx|ts|tsx)$/u,
  /^mobile\/scripts\//u,
  /^mobile\/.*\.(?:md|snap)$/u,
  /^(?:\.gitignore|README\.md|package\.json|package-lock\.json)$/u,
];

function normalizePath(path) {
  return path.trim().replaceAll('\\', '/').replace(/^\.\//u, '');
}

function matchesAny(path, patterns) {
  return patterns.some(pattern => pattern.test(path));
}

export function classifyFiles(inputFiles) {
  const files = [...new Set(inputFiles.map(normalizePath).filter(Boolean))];
  const nativeFiles = files.filter(path => matchesAny(path, nativePatterns));
  const nonRuntimeFiles = files.filter(path =>
    matchesAny(path, nonRuntimePatterns),
  );
  const otaFiles = files.filter(
    path =>
      matchesAny(path, otaSourcePatterns) &&
      !matchesAny(path, nonRuntimePatterns),
  );
  const unknownFiles = files.filter(
    path =>
      !matchesAny(path, nativePatterns) &&
      !matchesAny(path, otaSourcePatterns) &&
      !matchesAny(path, nonRuntimePatterns),
  );

  if (nativeFiles.length > 0) {
    return {
      classification: UPDATE_CLASSIFICATIONS.NATIVE_BUILD_REQUIRED,
      files,
      nativeFiles,
      otaFiles,
      nonRuntimeFiles,
      unknownFiles,
      reason:
        'Native proje, bağımlılık veya build/runtime yapılandırması değişti.',
    };
  }

  if (unknownFiles.length > 0 || otaFiles.length === 0) {
    return {
      classification: UPDATE_CLASSIFICATIONS.MANUAL_REVIEW_REQUIRED,
      files,
      nativeFiles,
      otaFiles,
      nonRuntimeFiles,
      unknownFiles,
      reason:
        unknownFiles.length > 0
          ? 'Sınıflandırılmamış dosya bulundu; OTA kapısı fail-closed kaldı.'
          : 'Yayımlanabilir bir mobil runtime değişikliği bulunamadı.',
    };
  }

  return {
    classification: UPDATE_CLASSIFICATIONS.OTA_SAFE,
    files,
    nativeFiles,
    otaFiles,
    nonRuntimeFiles,
    unknownFiles,
    reason:
      'Yalnız JavaScript/TypeScript ve mevcut runtime ile uyumlu asset değişti.',
  };
}

export function parseNameStatusZ(output) {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const files = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++];
    if (!GIT_STATUS_PATTERN.test(status)) {
      throw new Error(`Beklenmeyen git diff durumu: ${status || '<boş>'}`);
    }
    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error(`Eksik git diff yolu: ${status}`);
    }
    for (let offset = 0; offset < pathCount; offset += 1) {
      files.push(fields[index++]);
    }
  }
  return files;
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function changedFiles() {
  const explicitFiles = option('files');
  if (explicitFiles !== undefined) {
    return explicitFiles.split(',');
  }

  const base = option('base') || process.env.OTA_BASE_SHA;
  const head = option('head') || process.env.OTA_HEAD_SHA || 'HEAD';
  if (!base) {
    throw new Error(
      'OTA_BASE_SHA veya --base zorunludur; örtük karşılaştırma yapılmaz.',
    );
  }
  const result = spawnSync(
    'git',
    [
      'diff',
      '--name-status',
      '-z',
      `--diff-filter=${GIT_DIFF_FILTER}`,
      base,
      head,
      '--',
    ],
    { encoding: 'utf8', shell: false, maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'git diff çalıştırılamadı.');
  }
  return parseNameStatusZ(result.stdout);
}

function runCli() {
  const result = classifyFiles(changedFiles());
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `classification=${result.classification}\n`,
      'utf8',
    );
  }
  if (
    process.argv.includes('--assert-ota-safe') &&
    result.classification !== UPDATE_CLASSIFICATIONS.OTA_SAFE
  ) {
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

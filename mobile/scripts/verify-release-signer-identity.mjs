import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const ANDROID_FINGERPRINT_PATTERN = /^[0-9A-F]{64}$/u;
const IOS_TEAM_ID_PATTERN = /^[0-9A-Z]{10}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find(value => value.startsWith(prefix))
    ?.slice(prefix.length);
}

function repositoryPath(path, label, { mustExist = true } = {}) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error(`${label} yolu zorunludur.`);
  }
  const absolute = resolve(root, path);
  const scoped = relative(root, absolute).split(sep).join('/');
  if (!scoped || scoped === '..' || scoped.startsWith('../')) {
    throw new Error(`${label} mobile repository kökü içinde olmalı.`);
  }
  if (mustExist) {
    if (!existsSync(absolute)) throw new Error(`${label} bulunamadı: ${path}`);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`${label} symlink olmayan normal bir dosya olmalı.`);
    }
  } else if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`${label} symlink olamaz.`);
  }
  return absolute;
}

export function validateExpectedAndroidFingerprint(value) {
  if (typeof value !== 'string' || !ANDROID_FINGERPRINT_PATTERN.test(value)) {
    throw new Error(
      'ANDROID_SIGNING_CERT_SHA256 tam 64 büyük harf hexadecimal karakter olmalı; iki nokta/boşluk içeremez.',
    );
  }
  return value;
}

export function validateExpectedIosTeamId(value) {
  if (typeof value !== 'string' || !IOS_TEAM_ID_PATTERN.test(value)) {
    throw new Error(
      'IOS_SIGNING_TEAM_ID tam 10 büyük harf alfasayısal karakter olmalı.',
    );
  }
  return value;
}

export function certificateIdentityFromKeytoolOutput(output) {
  if (typeof output !== 'string') {
    throw new Error('Android signer certificate çıktısı okunamadı.');
  }
  const signers = [...output.matchAll(/^Signer #[0-9]+:/gmu)];
  if (signers.length !== 1) {
    throw new Error(
      'Signed Android artifact tam olarak bir signer identity içermeli.',
    );
  }
  const certificatePem = output.match(CERTIFICATE_PATTERN)?.[0];
  if (!certificatePem) {
    throw new Error(
      'Signed Android artifact içinde signer certificate bulunamadı.',
    );
  }
  let certificate;
  try {
    certificate = new X509Certificate(certificatePem);
  } catch {
    throw new Error('Android signer certificate geçerli X.509 PEM değil.');
  }
  return {
    fingerprintSha256: certificate.fingerprint256
      .replaceAll(':', '')
      .toUpperCase(),
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
  };
}

export function verifyAndroidSignerIdentity({
  expectedFingerprint,
  keytoolOutput,
}) {
  const expected = validateExpectedAndroidFingerprint(expectedFingerprint);
  const certificate = certificateIdentityFromKeytoolOutput(keytoolOutput);
  if (certificate.fingerprintSha256 !== expected) {
    throw new Error(
      'Android artifact signer certificate SHA-256 değeri onaylı fingerprint ile eşleşmiyor.',
    );
  }
  return {
    platform: 'android',
    expectedSigningCertificateSha256: expected,
    actualSigningCertificateSha256: certificate.fingerprintSha256,
    certificateSubject: certificate.subject,
    certificateIssuer: certificate.issuer,
    certificateSerialNumber: certificate.serialNumber,
    certificateValidFrom: certificate.validFrom,
    certificateValidTo: certificate.validTo,
  };
}

export function verifyIosSignerIdentity({
  expectedTeamId,
  codesignTeamId,
  entitlementTeamId,
  applicationIdentifier,
  bundleIdentifier,
}) {
  const expected = validateExpectedIosTeamId(expectedTeamId);
  if (
    typeof bundleIdentifier !== 'string' ||
    !/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/u.test(bundleIdentifier)
  ) {
    throw new Error('iOS bundle identifier güvenli canonical biçimde değil.');
  }
  for (const [label, value] of [
    ['codesign TeamIdentifier', codesignTeamId],
    ['entitlement team identifier', entitlementTeamId],
  ]) {
    if (typeof value !== 'string' || !IOS_TEAM_ID_PATTERN.test(value)) {
      throw new Error(`iOS ${label} güvenli 10 karakter biçiminde değil.`);
    }
    if (value !== expected) {
      throw new Error(
        `iOS ${label} onaylı IOS_SIGNING_TEAM_ID ile eşleşmiyor.`,
      );
    }
  }
  const expectedApplicationIdentifier = `${expected}.${bundleIdentifier}`;
  if (applicationIdentifier !== expectedApplicationIdentifier) {
    throw new Error(
      'iOS application-identifier onaylı Team ID ve bundle identifier ile eşleşmiyor.',
    );
  }
  return {
    platform: 'ios',
    expectedTeamId: expected,
    codesignTeamId,
    entitlementTeamId,
    bundleIdentifier,
    applicationIdentifier,
  };
}

function androidKeytoolOutput(artifactPath) {
  const artifact = repositoryPath(artifactPath, 'Signed Android artifact');
  const result = spawnSync(
    'keytool',
    [
      '-J-Duser.language=en',
      '-J-Duser.country=US',
      '-printcert',
      '-jarfile',
      artifact,
      '-rfc',
    ],
    {
      encoding: 'utf8',
      shell: false,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.error?.message ||
        'keytool Android signer certificate çıkaramadı.',
    );
  }
  return result.stdout;
}

function writeEvidence(path, evidence) {
  const output = repositoryPath(path, 'Signer identity evidence', {
    mustExist: false,
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function runCli() {
  const platform = option('platform');
  const preflight = process.argv.includes('--preflight');
  if (platform === 'android') {
    const expectedFingerprint = validateExpectedAndroidFingerprint(
      process.env.ANDROID_SIGNING_CERT_SHA256,
    );
    if (preflight) {
      console.log('Android expected signer fingerprint biçimi geçerli.');
      return;
    }
    const evidence = verifyAndroidSignerIdentity({
      expectedFingerprint,
      keytoolOutput: androidKeytoolOutput(option('android-artifact')),
    });
    finishEvidence(evidence);
    return;
  }
  if (platform === 'ios') {
    const expectedTeamId = validateExpectedIosTeamId(
      process.env.IOS_SIGNING_TEAM_ID,
    );
    if (preflight) {
      console.log('iOS expected signing Team ID biçimi geçerli.');
      return;
    }
    const appConfig = JSON.parse(
      readFileSync(resolve(root, 'app.json'), 'utf8'),
    ).expo;
    const evidence = verifyIosSignerIdentity({
      expectedTeamId,
      codesignTeamId: option('ios-codesign-team-id'),
      entitlementTeamId: option('ios-entitlement-team-id'),
      applicationIdentifier: option('ios-application-identifier'),
      bundleIdentifier: appConfig.ios?.bundleIdentifier,
    });
    finishEvidence(evidence);
    return;
  }
  throw new Error('--platform=android veya --platform=ios zorunludur.');
}

function finishEvidence(identity) {
  const targetSha = option('target-sha');
  if (!SHA_PATTERN.test(targetSha ?? '')) {
    throw new Error(
      '--target-sha tam 40 karakter küçük harf commit SHA olmalı.',
    );
  }
  const evidence = {
    schemaVersion: 1,
    targetSha,
    ...identity,
    verifiedAt: new Date().toISOString(),
  };
  const output = option('output');
  if (!output)
    throw new Error('--output signer identity evidence için zorunludur.');
  writeEvidence(output, evidence);
  console.log(`${identity.platform} release signer identity doğrulandı.`);
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

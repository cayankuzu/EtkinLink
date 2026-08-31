import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import test from 'node:test';

import {
  certificateIdentityFromKeytoolOutput,
  validateExpectedAndroidFingerprint,
  validateExpectedIosTeamId,
  verifyAndroidSignerIdentity,
  verifyIosSignerIdentity,
} from './verify-release-signer-identity.mjs';

const TEST_ONLY_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIC4DCCAcigAwIBAgIJAMlasmYrS5KBMA0GCSqGSIb3DQEBCwUAMB4xHDAaBgNV
BAMTE0V0a2luTGluayBUZXN0IE9ubHkwHhcNMjYwODMwMTMzMTI4WhcNMjYwOTAx
MTMzMTI4WjAeMRwwGgYDVQQDExNFdGtpbkxpbmsgVGVzdCBPbmx5MIIBIjANBgkq
hkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmeYrrlv8JiamlmgeAnFzplqqj7fIzQJV
EpwAunaJJwy7QLtm45BdQ7nYpRvC7fGaIPwLyKfGpTbj8T8FOXLX1ZVr1lF/eFrG
LIy8eR+CoJ/7yC9DIRGZDDNZrB/CmSkj0lDCihowcWSdjC3jJCEYCARDJZpyTFhj
t7ag2PTBqVfwWOIzXxgBKsATDRCbjqGej8DyMiV9QTSDCKMzX3fRoaX7mNDEUfvH
aJ2q2vPCx03eRE+wW+FoRIgKPGmPSY3kfyiq5k8IJo6joCo/rkdLhtuicPU1U6NP
pRfrSI7XHSt46T8XgiIOGQFDTkz+m0+DAyaJHe7ggK6eZ629USOxGwIDAQABoyEw
HzAdBgNVHQ4EFgQUTKTP9Xbb73AHLNmbeDNoO1m+eDkwDQYJKoZIhvcNAQELBQAD
ggEBAHkLORrTBUBkjh6PMx6l02R/l2wTatdQ0AY7yOL50H6T6p4gv8UvpkWjXQjm
D23GWYSLt/GH57yvUp6vN3ODj8ix7cOHGaZP+lMPxF/v8eDhlTbUFFP+M0wV8R66
3pto22Sxi258HgXa8i0WEJOgqvV/y3hG1yI9NahnM6pMHXDmrzIyAPVgXMyPEK02
bzZi170LRH3m1tUjuwI3iZ5fhv2O6rVDy4oPTPO0IAAFfXqBZcNAtOxfj7d07pV+
G7ZT0OsKWNwcBt8ay/BW4G2c87S0/7fZdoJ6zGms7G3JRsEOIyZNVEbe5CEKqLzs
C1Lo9nbIk/RKmyE1/ahwZHC9a+k=
-----END CERTIFICATE-----`;

const TEST_FINGERPRINT = new X509Certificate(
  TEST_ONLY_CERTIFICATE,
).fingerprint256
  .replaceAll(':', '')
  .toUpperCase();

test('Android expected fingerprint yalnız canonical SHA-256 biçimini kabul eder', () => {
  assert.equal(
    validateExpectedAndroidFingerprint(TEST_FINGERPRINT),
    TEST_FINGERPRINT,
  );
  for (const invalid of [
    '',
    TEST_FINGERPRINT.toLowerCase(),
    new X509Certificate(TEST_ONLY_CERTIFICATE).fingerprint256,
    'A'.repeat(63),
    'G'.repeat(64),
  ]) {
    assert.throws(
      () => validateExpectedAndroidFingerprint(invalid),
      /ANDROID_SIGNING_CERT_SHA256/u,
    );
  }
});

test('Android artifact certificate fingerprint tam eşleşir', () => {
  const output = `Signer #1:\nCertificate #1:\n${TEST_ONLY_CERTIFICATE}\n`;
  assert.equal(
    certificateIdentityFromKeytoolOutput(output).fingerprintSha256,
    TEST_FINGERPRINT,
  );
  const result = verifyAndroidSignerIdentity({
    expectedFingerprint: TEST_FINGERPRINT,
    keytoolOutput: output,
  });
  assert.equal(result.actualSigningCertificateSha256, TEST_FINGERPRINT);
  const wrong = `${
    TEST_FINGERPRINT[0] === 'A' ? 'B' : 'A'
  }${TEST_FINGERPRINT.slice(1)}`;
  assert.throws(
    () =>
      verifyAndroidSignerIdentity({
        expectedFingerprint: wrong,
        keytoolOutput: output,
      }),
    /eşleşmiyor/u,
  );
});

test('Android certificate çıktısı yoksa veya bozuksa fail-closed kalır', () => {
  assert.throws(
    () => certificateIdentityFromKeytoolOutput('Signer #1: no certificate'),
    /bulunamadı/u,
  );
  assert.throws(
    () =>
      certificateIdentityFromKeytoolOutput(
        'Signer #1:\n-----BEGIN CERTIFICATE-----\nbad\n-----END CERTIFICATE-----',
      ),
    /geçerli X.509/u,
  );
  assert.throws(
    () =>
      certificateIdentityFromKeytoolOutput(
        `Signer #1:\n${TEST_ONLY_CERTIFICATE}\nSigner #2:\n${TEST_ONLY_CERTIFICATE}`,
      ),
    /tam olarak bir signer/u,
  );
});

test('iOS expected Team ID yalnız canonical biçimi kabul eder', () => {
  assert.equal(validateExpectedIosTeamId('A1B2C3D4E5'), 'A1B2C3D4E5');
  for (const invalid of ['', 'a1b2c3d4e5', 'A1B2C3D4E', 'A1B2C3D4E-']) {
    assert.throws(
      () => validateExpectedIosTeamId(invalid),
      /IOS_SIGNING_TEAM_ID/u,
    );
  }
});

test('iOS codesign, entitlement ve application identifier aynı Team ID ile eşleşir', () => {
  const valid = {
    expectedTeamId: 'A1B2C3D4E5',
    codesignTeamId: 'A1B2C3D4E5',
    entitlementTeamId: 'A1B2C3D4E5',
    applicationIdentifier: 'A1B2C3D4E5.com.etkinlink.app',
    bundleIdentifier: 'com.etkinlink.app',
  };
  assert.equal(verifyIosSignerIdentity(valid).platform, 'ios');
  assert.throws(
    () => verifyIosSignerIdentity({ ...valid, codesignTeamId: 'Z1B2C3D4E5' }),
    /eşleşmiyor/u,
  );
  assert.throws(
    () =>
      verifyIosSignerIdentity({
        ...valid,
        applicationIdentifier: 'A1B2C3D4E5.com.other.app',
      }),
    /application-identifier/u,
  );
});

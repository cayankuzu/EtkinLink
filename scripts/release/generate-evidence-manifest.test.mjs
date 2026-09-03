import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  collectArtifacts,
  validateClaims,
} from "./generate-evidence-manifest.mjs";
import {
  applyEvidenceClaims,
  validateManualEvidenceZip,
  validateManualAttestation,
} from "./apply-evidence-claims.mjs";

const sha = "a".repeat(40);

function lstatSize(path) {
  return statSync(path).size;
}

function write(path, contents) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function json(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runMetadata(root, key, id, workflow, event = "workflow_dispatch") {
  const value = {
    id,
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    path: `.github/workflows/${workflow}`,
    event,
    run_attempt: 2,
    repository: { full_name: "owner/repository" },
    head_repository: { full_name: "owner/repository" },
  };
  json(resolve(root, `run-metadata/${key}.json`), value);
  return value;
}

function zipBasedArtifact(path, bytes = 100_001) {
  const contents = Buffer.alloc(bytes);
  contents.set([0x50, 0x4b, 0x03, 0x04]);
  write(path, contents);
}

function checksumFiles(artifactRoot, manifestPath, logicalFiles) {
  const lines = logicalFiles.map(([logicalPath, physicalPath]) => {
    const digest = createHash("sha256")
      .update(readFileSync(resolve(artifactRoot, physicalPath)))
      .digest("hex");
    return `${digest}  ${logicalPath}`;
  });
  write(resolve(artifactRoot, manifestPath), `${lines.join("\n")}\n`);
}

let prerequisiteArtifactId = 1;
function prerequisiteArtifact(name, files, metadata) {
  prerequisiteArtifactId += 1;
  return {
    id: prerequisiteArtifactId,
    name,
    archiveDigest: `sha256:${"a".repeat(64)}`,
    archiveBytes: 1_000,
    uncompressedBytes: 2_000,
    files,
    contentDigests: Object.fromEntries(
      files.map((path) => [path, `sha256:${"b".repeat(64)}`]),
    ),
    ...(metadata ? { metadata } : {}),
  };
}

function createZip(path, entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? "");
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const local = Buffer.alloc(30 + name.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.uncompressedBytes ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    data.copy(local, 30 + name.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.uncompressedBytes ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0x81a40000, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  writeFileSync(path, Buffer.concat([...localRecords, central, end]));
}

test("hashes regular evidence files with repository-relative paths", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-evidence-"));
  try {
    mkdirSync(resolve(root, "artifacts/input"), { recursive: true });
    writeFileSync(
      resolve(root, "artifacts/input/result.json"),
      '{"ok":true}\n',
    );
    const artifacts = collectArtifacts(root, ["artifacts/input"]);
    assert.deepEqual(
      artifacts.map((artifact) => artifact.path),
      ["artifacts/input/result.json"],
    );
    assert.equal(artifacts[0].bytes, 12);
    assert.match(artifacts[0].sha256, /^[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects verified claims without exact SHA and included artifact", () => {
  const document = {
    schemaVersion: 1,
    gates: [
      {
        id: "signed_artifact",
        required: true,
        status: "verified",
        sameCommitSha: sha,
        evidencePaths: ["artifacts/aab"],
      },
    ],
  };
  assert.throws(
    () => validateClaims(document, "b".repeat(40), new Set(["artifacts/aab"])),
    /different or missing commit SHA/u,
  );
  assert.throws(
    () => validateClaims(document, sha, new Set()),
    /missing artifact/u,
  );
});

test("keeps missing and attached evidence from becoming verified", () => {
  const gates = validateClaims(
    {
      schemaVersion: 1,
      gates: [
        { id: "device", required: true, status: "missing", evidencePaths: [] },
        {
          id: "ota",
          required: true,
          status: "attached",
          evidencePaths: ["review/url"],
        },
      ],
    },
    sha,
    new Set(),
  );
  assert.deepEqual(
    gates.map((gate) => gate.status),
    ["missing", "attached"],
  );
});

test("promotes only approved exact-SHA manual evidence with regular files", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-manual-evidence-"));
  try {
    const gateRoot = resolve(
      root,
      "artifacts/evidence-input/manual/backup_restore",
    );
    mkdirSync(gateRoot, { recursive: true });
    writeFileSync(resolve(gateRoot, "restore.json"), '{"passed":true}\n');
    writeFileSync(
      resolve(gateRoot, "attestation.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        gateId: "backup_restore",
        targetSha: sha,
        decision: "approved",
        reviewer: "release-owner",
        reviewedAt: "2026-08-30T12:00:00Z",
        evidenceFiles: ["restore.json"],
      })}\n`,
    );
    const document = {
      schemaVersion: 1,
      gates: [
        {
          id: "backup_restore",
          required: true,
          status: "missing",
          evidencePaths: [],
        },
      ],
    };
    applyEvidenceClaims(document, {
      targetSha: sha,
      repositoryRoot: root,
      artifactRoot: resolve(root, "artifacts/evidence-input"),
      environment: {},
      manualReleaseTag: "evidence-a",
    });
    assert.equal(document.gates[0].status, "verified");
    assert.equal(document.gates[0].sameCommitSha, sha);
    assert.deepEqual(document.gates[0].evidencePaths, [
      "artifacts/evidence-input/manual/backup_restore/attestation.json",
      "artifacts/evidence-input/manual/backup_restore/restore.json",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unapproved, wrong-SHA, and unsafe manual attestations", () => {
  const valid = {
    schemaVersion: 1,
    gateId: "backup_restore",
    targetSha: sha,
    decision: "approved",
    reviewer: "release-owner",
    reviewedAt: "2026-08-30T12:00:00Z",
    evidenceFiles: ["restore.json"],
  };
  assert.throws(
    () =>
      validateManualAttestation(
        { ...valid, decision: "pending" },
        { gateId: "backup_restore", targetSha: sha },
      ),
    /Invalid manual evidence attestation/u,
  );
  assert.throws(
    () =>
      validateManualAttestation(valid, {
        gateId: "backup_restore",
        targetSha: "b".repeat(40),
      }),
    /Invalid manual evidence attestation/u,
  );

  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-unsafe-evidence-"));
  try {
    const gateRoot = resolve(
      root,
      "artifacts/evidence-input/manual/backup_restore",
    );
    mkdirSync(gateRoot, { recursive: true });
    writeFileSync(
      resolve(gateRoot, "attestation.json"),
      `${JSON.stringify({ ...valid, evidenceFiles: ["../outside.json"] })}\n`,
    );
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "backup_restore", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot: resolve(root, "artifacts/evidence-input"),
            environment: {},
            manualReleaseTag: "evidence-a",
          },
        ),
      /Unsafe manual evidence path/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifies only exact mobile CI and local database security artifacts", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-run-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    runMetadata(artifactRoot, "mobile_ci", 123, "mobile-ci.yml", "push");
    json(
      resolve(
        artifactRoot,
        "mobile_ci/etkinlink-mobile-sbom/mobile-sbom.cdx.json",
      ),
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        version: 1,
        components: [{ type: "library", name: "react-native" }],
      },
    );
    zipBasedArtifact(
      resolve(artifactRoot, "mobile_ci/etkinlink-debug-apk/app-debug.apk"),
    );
    write(
      resolve(
        artifactRoot,
        "mobile_ci/local-database-security-evidence/db-start.txt",
      ),
      "Starting database\nApplying migration\nStarted supabase local development setup.\n",
    );
    write(
      resolve(
        artifactRoot,
        "mobile_ci/local-database-security-evidence/db-lint.txt",
      ),
      "No schema errors found\n",
    );
    write(
      resolve(
        artifactRoot,
        "mobile_ci/local-database-security-evidence/pgtap.txt",
      ),
      "All tests successful.\nResult: PASS\n",
    );
    mkdirSync(resolve(artifactRoot, "ota_production"), { recursive: true });
    writeFileSync(
      resolve(artifactRoot, "ota_production/metadata.json"),
      "{}\n",
    );
    const document = {
      schemaVersion: 1,
      gates: [
        { id: "mobile_ci", status: "missing", evidencePaths: [] },
        { id: "database_rls", status: "missing", evidencePaths: [] },
        {
          id: "ota_preview_rollback",
          status: "missing",
          evidencePaths: [],
        },
      ],
    };
    applyEvidenceClaims(document, {
      targetSha: sha,
      repositoryRoot: root,
      artifactRoot,
      environment: {
        MOBILE_CI_RUN_ID: "123",
        OTA_PRODUCTION_RUN_ID: "456",
        GITHUB_REPOSITORY: "owner/repository",
      },
    });
    assert.deepEqual(
      document.gates.map((gate) => gate.status),
      ["verified", "verified", "attached"],
    );
    assert.ok(
      document.gates[0].evidencePaths.includes(
        "artifacts/evidence-input/mobile_ci/etkinlink-debug-apk/app-debug.apk",
      ),
    );
    assert.ok(
      document.gates[1].evidencePaths.includes(
        "artifacts/evidence-input/mobile_ci/local-database-security-evidence/pgtap.txt",
      ),
    );

    write(
      resolve(
        artifactRoot,
        "mobile_ci/local-database-security-evidence/pgtap.txt",
      ),
      "not ok 1 - RLS leak\nResult: FAIL\n",
    );
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "database_rls", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              MOBILE_CI_RUN_ID: "123",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /pgTAP evidence is not an unambiguous passing result/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not verify an automated gate from an arbitrary downloaded file", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-fake-run-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    runMetadata(artifactRoot, "mobile_ci", 123, "mobile-ci.yml", "push");
    write(resolve(artifactRoot, "mobile_ci/unrelated/file.txt"), "success\n");
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "mobile_ci", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              MOBILE_CI_RUN_ID: "123",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /Missing mobile_ci\/etkinlink-mobile-sbom artifact/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("binds both staging E2E artifacts to the run attempt and full checksums", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-e2e-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    runMetadata(artifactRoot, "staging_e2e", 456, "mobile-e2e.yml");
    const maestro = resolve(
      artifactRoot,
      "staging_e2e/android-maestro-evidence",
    );
    write(
      resolve(maestro, "mobile/e2e-results.xml"),
      '<testsuite tests="2" failures="0" errors="0"></testsuite>\n',
    );
    write(resolve(maestro, "mobile/e2e-debug/commands.log"), "passed\n");
    json(resolve(maestro, "artifacts/e2e/android-maestro/metadata.json"), {
      schemaVersion: 1,
      targetSha: sha,
      runId: 456,
      runAttempt: 2,
      workflow: ".github/workflows/mobile-e2e.yml",
      job: "android-maestro",
    });
    checksumFiles(maestro, "artifacts/e2e/android-maestro/SHA256SUMS", [
      ["mobile/e2e-debug/commands.log", "mobile/e2e-debug/commands.log"],
      ["mobile/e2e-results.xml", "mobile/e2e-results.xml"],
      [
        "artifacts/e2e/android-maestro/metadata.json",
        "artifacts/e2e/android-maestro/metadata.json",
      ],
    ]);

    const backend = resolve(
      artifactRoot,
      "staging_e2e/staging-critical-backend-e2e-evidence",
    );
    json(resolve(backend, "mobile/artifacts/staging-critical-e2e.json"), {
      runId: "backend-run",
      status: "passed",
      evidence: [{ step: "auth", status: "passed" }],
    });
    json(
      resolve(backend, "artifacts/e2e/backend-critical-flows/metadata.json"),
      {
        schemaVersion: 1,
        targetSha: sha,
        runId: 456,
        runAttempt: 2,
        workflow: ".github/workflows/mobile-e2e.yml",
        job: "backend-critical-flows",
      },
    );
    checksumFiles(backend, "artifacts/e2e/backend-critical-flows/SHA256SUMS", [
      [
        "mobile/artifacts/staging-critical-e2e.json",
        "mobile/artifacts/staging-critical-e2e.json",
      ],
      [
        "artifacts/e2e/backend-critical-flows/metadata.json",
        "artifacts/e2e/backend-critical-flows/metadata.json",
      ],
    ]);
    const document = {
      schemaVersion: 1,
      gates: [{ id: "staging_e2e", status: "missing", evidencePaths: [] }],
    };
    applyEvidenceClaims(document, {
      targetSha: sha,
      repositoryRoot: root,
      artifactRoot,
      environment: {
        STAGING_E2E_RUN_ID: "456",
        GITHUB_REPOSITORY: "owner/repository",
      },
    });
    assert.equal(document.gates[0].status, "verified");
    assert.equal(document.gates[0].evidencePaths.length, 8);

    const metadataPath = resolve(
      maestro,
      "artifacts/e2e/android-maestro/metadata.json",
    );
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    json(metadataPath, { ...metadata, runAttempt: 1 });
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "staging_e2e", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              STAGING_E2E_RUN_ID: "456",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /does not match the workflow run/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires exact 10000 VU load metadata and checksummed summaries", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-load-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    runMetadata(artifactRoot, "staging_load", 789, "staging-load-test.yml");
    const load = resolve(
      artifactRoot,
      "staging_load/staging-mixed-load-evidence-10000vu",
    );
    for (const name of [
      "load-low-25vu.json",
      "load-medium-250vu.json",
      "load-target-10000vu.json",
    ]) {
      json(resolve(load, name), {
        metrics: {
          iterations: { values: { count: 10 } },
          http_reqs: { values: { count: 100 } },
          http_req_failed: { thresholds: { "rate<0.01": { ok: true } } },
          http_req_duration: {
            thresholds: { "p(95)<1200": { ok: true } },
          },
          checks: { thresholds: { "rate>0.99": { ok: true } } },
        },
        root_group: {},
      });
    }
    json(resolve(load, "load-evidence-metadata.json"), {
      schemaVersion: 1,
      targetSha: sha,
      runId: 789,
      runAttempt: 2,
      workflow: ".github/workflows/staging-load-test.yml",
      job: "staged-load-test",
      targetVus: 10_000,
    });
    const names = [
      "load-evidence-metadata.json",
      "load-low-25vu.json",
      "load-medium-250vu.json",
      "load-target-10000vu.json",
    ];
    checksumFiles(
      load,
      "SHA256SUMS",
      names.map((name) => [`artifacts/${name}`, name]),
    );
    const document = {
      schemaVersion: 1,
      gates: [{ id: "staging_load", status: "missing", evidencePaths: [] }],
    };
    applyEvidenceClaims(document, {
      targetSha: sha,
      repositoryRoot: root,
      artifactRoot,
      environment: {
        STAGING_LOAD_RUN_ID: "789",
        GITHUB_REPOSITORY: "owner/repository",
      },
    });
    assert.equal(document.gates[0].status, "verified");

    const metadataPath = resolve(load, "load-evidence-metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    json(metadataPath, { ...metadata, targetVus: 9_999 });
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "staging_load", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              STAGING_LOAD_RUN_ID: "789",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /does not match the workflow run/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires signed Android and iOS artifacts with exact-SHA signer identities", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-native-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    runMetadata(artifactRoot, "mobile_release", 987, "mobile-release.yml");
    json(
      resolve(
        artifactRoot,
        "mobile_release/release-prerequisite-evidence/release-prerequisite-evidence.json",
      ),
      {
        schemaVersion: 2,
        checkedAt: "2026-08-31T12:00:00Z",
        commit: sha,
        evidence: [
          {
            workflow: "mobile-ci.yml",
            runId: 101,
            runAttempt: 1,
            event: "push",
            headSha: sha,
            completedAt: "2026-08-31T11:00:00Z",
            runUrl: "https://github.com/owner/repository/actions/runs/101",
            artifacts: [
              prerequisiteArtifact("etkinlink-mobile-sbom", [
                "mobile-sbom.cdx.json",
              ]),
              prerequisiteArtifact("etkinlink-debug-apk", ["app-debug.apk"]),
              prerequisiteArtifact("local-database-security-evidence", [
                "db-lint.txt",
                "db-start.txt",
                "pgtap.txt",
              ]),
            ],
          },
          {
            workflow: "mobile-e2e.yml",
            runId: 102,
            runAttempt: 1,
            event: "workflow_dispatch",
            headSha: sha,
            completedAt: "2026-08-31T11:10:00Z",
            runUrl: "https://github.com/owner/repository/actions/runs/102",
            artifacts: [
              prerequisiteArtifact(
                "android-maestro-evidence",
                [
                  "artifacts/e2e/android-maestro/SHA256SUMS",
                  "artifacts/e2e/android-maestro/metadata.json",
                  "mobile/e2e-results.xml",
                  "mobile/e2e-debug/commands.log",
                ],
                {
                  schemaVersion: 1,
                  targetSha: sha,
                  runId: 102,
                  runAttempt: 1,
                  workflow: ".github/workflows/mobile-e2e.yml",
                  job: "android-maestro",
                },
              ),
              prerequisiteArtifact(
                "staging-critical-backend-e2e-evidence",
                [
                  "artifacts/e2e/backend-critical-flows/SHA256SUMS",
                  "artifacts/e2e/backend-critical-flows/metadata.json",
                  "mobile/artifacts/staging-critical-e2e.json",
                ],
                {
                  schemaVersion: 1,
                  targetSha: sha,
                  runId: 102,
                  runAttempt: 1,
                  workflow: ".github/workflows/mobile-e2e.yml",
                  job: "backend-critical-flows",
                },
              ),
            ],
          },
          {
            workflow: "staging-load-test.yml",
            runId: 103,
            runAttempt: 1,
            event: "workflow_dispatch",
            headSha: sha,
            completedAt: "2026-08-31T11:20:00Z",
            runUrl: "https://github.com/owner/repository/actions/runs/103",
            artifacts: [
              prerequisiteArtifact(
                "staging-mixed-load-evidence-10000vu",
                [
                  "SHA256SUMS",
                  "load-evidence-metadata.json",
                  "load-low-25vu.json",
                  "load-medium-250vu.json",
                  "load-target-10000vu.json",
                ],
                {
                  schemaVersion: 1,
                  targetSha: sha,
                  runId: 103,
                  runAttempt: 1,
                  workflow: ".github/workflows/staging-load-test.yml",
                  job: "staged-load-test",
                  targetVus: 10_000,
                },
              ),
            ],
          },
        ],
      },
    );
    const android = resolve(
      artifactRoot,
      "mobile_release/etkinlink-production-aab",
    );
    zipBasedArtifact(
      resolve(
        android,
        "android/app/build/outputs/bundle/release/app-release.aab",
      ),
      1_000_001,
    );
    write(
      resolve(android, "android/app/build/outputs/mapping/release/mapping.txt"),
      "mapping\n".repeat(20),
    );
    json(resolve(android, "artifacts/android-signer-identity.json"), {
      schemaVersion: 1,
      targetSha: sha,
      platform: "android",
      verifiedAt: "2026-08-31T12:00:00Z",
      expectedSigningCertificateSha256: "A".repeat(64),
      actualSigningCertificateSha256: "A".repeat(64),
      certificateSubject: "CN=EtkinLink",
      certificateIssuer: "CN=EtkinLink",
      certificateSerialNumber: "01",
      certificateValidFrom: "2026-01-01T00:00:00Z",
      certificateValidTo: "2036-01-01T00:00:00Z",
    });

    const ios = resolve(
      artifactRoot,
      "mobile_release/etkinlink-production-ipa-evidence",
    );
    zipBasedArtifact(resolve(ios, "artifacts/EtkinLink.ipa"), 1_000_001);
    write(
      resolve(ios, "artifacts/ios-entitlements.plist"),
      "<plist><dict><key>aps-environment</key><string>production</string>" +
        "<key>com.apple.developer.team-identifier</key><string>ABCDE12345</string>" +
        "<key>application-identifier</key><string>ABCDE12345.com.etkinlink.app</string>" +
        "</dict></plist>",
    );
    json(resolve(ios, "artifacts/ios-signer-identity.json"), {
      schemaVersion: 1,
      targetSha: sha,
      platform: "ios",
      verifiedAt: "2026-08-31T12:00:00Z",
      expectedTeamId: "ABCDE12345",
      codesignTeamId: "ABCDE12345",
      entitlementTeamId: "ABCDE12345",
      bundleIdentifier: "com.etkinlink.app",
      applicationIdentifier: "ABCDE12345.com.etkinlink.app",
    });
    write(
      resolve(ios, "artifacts/PrivacyInfo.xcprivacy"),
      "<plist><dict><key>NSPrivacyCollectedDataTypes</key><array/></dict></plist>",
    );
    json(resolve(ios, "eas-ios-build.json"), [
      {
        id: "eas-build-123",
        status: "FINISHED",
        platform: "IOS",
        buildProfile: "production",
        distribution: "STORE",
        isForIosSimulator: false,
        updateChannel: { name: "production" },
        gitCommitHash: sha,
        artifacts: { buildUrl: "https://expo.dev/artifacts/build.ipa" },
      },
    ]);
    const document = {
      schemaVersion: 1,
      gates: [
        { id: "signed_android_ios", status: "missing", evidencePaths: [] },
      ],
    };
    applyEvidenceClaims(document, {
      targetSha: sha,
      repositoryRoot: root,
      artifactRoot,
      environment: {
        MOBILE_RELEASE_RUN_ID: "987",
        GITHUB_REPOSITORY: "owner/repository",
      },
    });
    assert.equal(document.gates[0].status, "verified");

    const prerequisitePath = resolve(
      artifactRoot,
      "mobile_release/release-prerequisite-evidence/release-prerequisite-evidence.json",
    );
    const prerequisite = JSON.parse(readFileSync(prerequisitePath, "utf8"));
    prerequisite.evidence[0].artifacts[0].contentDigests[
      "mobile-sbom.cdx.json"
    ] = "sha256:invalid";
    json(prerequisitePath, prerequisite);
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "signed_android_ios", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              MOBILE_RELEASE_RUN_ID: "987",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /Invalid prerequisite artifact file/u,
    );
    prerequisite.evidence[0].artifacts[0].contentDigests[
      "mobile-sbom.cdx.json"
    ] = `sha256:${"b".repeat(64)}`;
    json(prerequisitePath, prerequisite);

    const easPath = resolve(ios, "eas-ios-build.json");
    const eas = JSON.parse(readFileSync(easPath, "utf8"));
    json(easPath, [{ ...eas[0], gitCommitHash: "b".repeat(40) }]);
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "signed_android_ios", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              MOBILE_RELEASE_RUN_ID: "987",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /not a finished same-SHA production build/u,
    );
    json(easPath, eas);

    const signerPath = resolve(
      android,
      "artifacts/android-signer-identity.json",
    );
    const signer = JSON.parse(readFileSync(signerPath, "utf8"));
    json(signerPath, { ...signer, targetSha: "b".repeat(40) });
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "signed_android_ios", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {
              MOBILE_RELEASE_RUN_ID: "987",
              GITHUB_REPOSITORY: "owner/repository",
            },
          },
        ),
      /not bound to target SHA/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails on a present but malformed manual attestation", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-bad-attestation-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    const gateRoot = resolve(artifactRoot, "manual/backup_restore");
    mkdirSync(gateRoot, { recursive: true });
    writeFileSync(resolve(gateRoot, "attestation.json"), "{not-json\n");
    assert.throws(
      () =>
        applyEvidenceClaims(
          {
            schemaVersion: 1,
            gates: [{ id: "backup_restore", status: "missing" }],
          },
          {
            targetSha: sha,
            repositoryRoot: root,
            artifactRoot,
            environment: {},
            manualReleaseTag: "evidence-a",
          },
        ),
      /Unreadable manual evidence attestation/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unsafe manual ZIPs before extraction", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-manual-zip-"));
  try {
    const valid = resolve(root, "valid.zip");
    createZip(valid, [
      { name: "backup_restore/attestation.json", data: "{}" },
      { name: "backup_restore/result.json", data: '{"ok":true}' },
    ]);
    assert.deepEqual(validateManualEvidenceZip(valid), {
      entries: 2,
      compressedBytes: lstatSize(valid),
      totalUncompressedBytes: 13,
    });
    assert.throws(
      () => validateManualEvidenceZip(valid, { maxEntries: 1 }),
      /empty, oversized, or structurally invalid/u,
    );
    assert.throws(
      () =>
        validateManualEvidenceZip(valid, {
          maxCompressedBytes: lstatSize(valid) - 1,
        }),
      /compressed size is out of bounds/u,
    );
    assert.throws(
      () =>
        validateManualEvidenceZip(valid, {
          maxTotalUncompressedBytes: 12,
        }),
      /uncompressed size exceeds/u,
    );

    const oversizedEntry = resolve(root, "oversized-entry.zip");
    createZip(oversizedEntry, [
      { name: "result.json", data: "x", uncompressedBytes: 11 },
    ]);
    assert.throws(
      () =>
        validateManualEvidenceZip(oversizedEntry, {
          maxEntryUncompressedBytes: 10,
        }),
      /uncompressed size exceeds/u,
    );

    const ratioBomb = resolve(root, "ratio-bomb.zip");
    createZip(ratioBomb, [
      {
        name: "result.json",
        data: "x",
        method: 8,
        uncompressedBytes: 1_000,
      },
    ]);
    assert.throws(
      () => validateManualEvidenceZip(ratioBomb),
      /compression ratio exceeds/u,
    );

    const encrypted = resolve(root, "encrypted.zip");
    createZip(encrypted, [
      { name: "result.json", data: "secret", flags: 0x0001 },
    ]);
    assert.throws(
      () => validateManualEvidenceZip(encrypted),
      /encrypted, ZIP64, or malformed/u,
    );

    const symlink = resolve(root, "symlink.zip");
    createZip(symlink, [
      {
        name: "result.json",
        data: "target.json",
        externalAttributes: 0xa1ff0000,
      },
    ]);
    assert.throws(
      () => validateManualEvidenceZip(symlink),
      /symlink or unsupported special entry/u,
    );

    const traversal = resolve(root, "traversal.zip");
    createZip(traversal, [{ name: "../outside.json", data: "{}" }]);
    assert.throws(
      () => validateManualEvidenceZip(traversal),
      /Unsafe manual evidence ZIP path/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs bounded manual ZIP validation before workflow extraction", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/release-evidence.yml"),
    "utf8",
  );
  const validator = workflow.indexOf('--validate-manual-zip="$BUNDLE"');
  const extraction = workflow.indexOf('unzip -q "$BUNDLE"');
  assert.ok(validator >= 0, "Manual ZIP validator must be wired.");
  assert.ok(extraction > validator, "Validation must run before extraction.");
  assert.match(workflow, /download_run mobile_ci .* mobile-ci\.yml push/u);
  assert.match(
    workflow,
    /download_run staging_e2e .* mobile-e2e\.yml schedule,workflow_dispatch/u,
  );
});

test("keeps OTA publication and unsafe Cloudflare rollout mechanically absent", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const previewOta = readFileSync(
    resolve(repositoryRoot, ".github/workflows/eas-update-preview.yml"),
    "utf8",
  );
  const productionOta = readFileSync(
    resolve(repositoryRoot, ".github/workflows/eas-update-production.yml"),
    "utf8",
  );
  for (const workflow of [previewOta, productionOta]) {
    assert.match(workflow, /publication blocked/u);
    assert.match(workflow, /exit 1/u);
    assert.doesNotMatch(
      workflow,
      /(?:eas-cli|channel:edit|EXPO_TOKEN|EAS_UPDATE_PRIVATE_KEY|--private-key-path)/u,
    );
  }
  assert.match(productionOta, /native_release_run_id/u);
  assert.match(productionOta, /--require-ota-signing/u);

  const productionWorker = readFileSync(
    resolve(repositoryRoot, ".github/workflows/cloudflare-production.yml"),
    "utf8",
  );
  assert.match(productionWorker, /Block unsafe production version mutation/u);
  assert.match(productionWorker, /exit 1/u);
  assert.doesNotMatch(
    productionWorker,
    /(?:CLOUDFLARE_API_TOKEN|wrangler versions (?:upload|deploy))/u,
  );
});

test("keeps native release signer identity checks wired fail-closed", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const mobileRelease = readFileSync(
    resolve(repositoryRoot, ".github/workflows/mobile-release.yml"),
    "utf8",
  );
  for (const required of [
    "vars.ANDROID_SIGNING_CERT_SHA256",
    "--platform=android --preflight",
    "--android-artifact=android/app/build/outputs/bundle/release/app-release.aab",
    "artifacts/android-signer-identity.json",
    "vars.IOS_SIGNING_TEAM_ID",
    "--platform=ios --preflight",
    "com.apple.developer.team-identifier",
    "application-identifier",
    "--ios-codesign-team-id",
    "artifacts/ios-signer-identity.json",
  ]) {
    assert.ok(
      mobileRelease.includes(required),
      `Missing release guard: ${required}`,
    );
  }
  const mobileCi = readFileSync(
    resolve(repositoryRoot, ".github/workflows/mobile-ci.yml"),
    "utf8",
  );
  assert.match(mobileCi, /npm run release:signer:test/u);
});

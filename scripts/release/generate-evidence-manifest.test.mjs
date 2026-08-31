import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  validateManualAttestation,
} from "./apply-evidence-claims.mjs";

const sha = "a".repeat(40);

test("hashes regular evidence files with repository-relative paths", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-evidence-"));
  try {
    mkdirSync(resolve(root, "artifacts/input"), { recursive: true });
    writeFileSync(
      resolve(root, "artifacts/input/result.json"),
      '{"ok":true}\n'
    );
    const artifacts = collectArtifacts(root, ["artifacts/input"]);
    assert.deepEqual(
      artifacts.map((artifact) => artifact.path),
      ["artifacts/input/result.json"]
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
    /different or missing commit SHA/u
  );
  assert.throws(
    () => validateClaims(document, sha, new Set()),
    /missing artifact/u
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
    new Set()
  );
  assert.deepEqual(
    gates.map((gate) => gate.status),
    ["missing", "attached"]
  );
});

test("promotes only approved exact-SHA manual evidence with regular files", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-manual-evidence-"));
  try {
    const gateRoot = resolve(
      root,
      "artifacts/evidence-input/manual/backup_restore"
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
      })}\n`
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
        { gateId: "backup_restore", targetSha: sha }
      ),
    /Invalid manual evidence attestation/u
  );
  assert.throws(
    () =>
      validateManualAttestation(valid, {
        gateId: "backup_restore",
        targetSha: "b".repeat(40),
      }),
    /Invalid manual evidence attestation/u
  );

  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-unsafe-evidence-"));
  try {
    const gateRoot = resolve(
      root,
      "artifacts/evidence-input/manual/backup_restore"
    );
    mkdirSync(gateRoot, { recursive: true });
    writeFileSync(
      resolve(gateRoot, "attestation.json"),
      `${JSON.stringify({ ...valid, evidenceFiles: ["../outside.json"] })}\n`
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
          }
        ),
      /Unsafe manual evidence path/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("maps successful workflow artifacts without treating rollback evidence as reviewed", () => {
  const root = mkdtempSync(resolve(tmpdir(), "etkinlink-run-evidence-"));
  try {
    const artifactRoot = resolve(root, "artifacts/evidence-input");
    mkdirSync(resolve(artifactRoot, "mobile_ci"), { recursive: true });
    mkdirSync(resolve(artifactRoot, "ota_production"), { recursive: true });
    writeFileSync(resolve(artifactRoot, "mobile_ci/results.json"), "{}\n");
    writeFileSync(
      resolve(artifactRoot, "ota_production/metadata.json"),
      "{}\n"
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
      },
    });
    assert.deepEqual(
      document.gates.map((gate) => gate.status),
      ["verified", "verified", "attached"]
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
          }
        ),
      /Unreadable manual evidence attestation/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps OTA publication and unsafe Cloudflare rollout mechanically absent", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const previewOta = readFileSync(
    resolve(repositoryRoot, ".github/workflows/eas-update-preview.yml"),
    "utf8"
  );
  const productionOta = readFileSync(
    resolve(repositoryRoot, ".github/workflows/eas-update-production.yml"),
    "utf8"
  );
  for (const workflow of [previewOta, productionOta]) {
    assert.match(workflow, /publication blocked/u);
    assert.match(workflow, /exit 1/u);
    assert.doesNotMatch(
      workflow,
      /(?:eas-cli|channel:edit|EXPO_TOKEN|EAS_UPDATE_PRIVATE_KEY|--private-key-path)/u
    );
  }
  assert.match(productionOta, /native_release_run_id/u);
  assert.match(productionOta, /--require-ota-signing/u);

  const productionWorker = readFileSync(
    resolve(repositoryRoot, ".github/workflows/cloudflare-production.yml"),
    "utf8"
  );
  assert.match(productionWorker, /Block unsafe production version mutation/u);
  assert.match(productionWorker, /exit 1/u);
  assert.doesNotMatch(
    productionWorker,
    /(?:CLOUDFLARE_API_TOKEN|wrangler versions (?:upload|deploy))/u
  );
});

test("keeps native release signer identity checks wired fail-closed", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const mobileRelease = readFileSync(
    resolve(repositoryRoot, ".github/workflows/mobile-release.yml"),
    "utf8"
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
      `Missing release guard: ${required}`
    );
  }
  const mobileCi = readFileSync(
    resolve(repositoryRoot, ".github/workflows/mobile-ci.yml"),
    "utf8"
  );
  assert.match(mobileCi, /npm run release:signer:test/u);
});

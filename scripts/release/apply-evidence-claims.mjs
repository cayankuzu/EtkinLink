import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;

const AUTOMATED_GATES = {
  mobile_ci: {
    environmentKey: "MOBILE_CI_RUN_ID",
    runKey: "mobile_ci",
    validate: validateMobileCi,
  },
  database_rls: {
    environmentKey: "MOBILE_CI_RUN_ID",
    runKey: "mobile_ci",
    validate: validateDatabaseRls,
  },
  staging_e2e: {
    environmentKey: "STAGING_E2E_RUN_ID",
    runKey: "staging_e2e",
    validate: validateStagingE2e,
  },
  staging_load: {
    environmentKey: "STAGING_LOAD_RUN_ID",
    runKey: "staging_load",
    validate: validateStagingLoad,
  },
  signed_android_ios: {
    environmentKey: "MOBILE_RELEASE_RUN_ID",
    runKey: "mobile_release",
    validate: validateMobileRelease,
  },
};

const RUN_CONTRACTS = {
  mobile_ci: { workflow: "mobile-ci.yml", events: ["push"] },
  staging_e2e: {
    workflow: "mobile-e2e.yml",
    events: ["schedule", "workflow_dispatch"],
  },
  staging_load: {
    workflow: "staging-load-test.yml",
    events: ["workflow_dispatch"],
  },
  mobile_release: {
    workflow: "mobile-release.yml",
    events: ["workflow_dispatch"],
  },
};

export const MANUAL_ZIP_LIMITS = Object.freeze({
  maxCompressedBytes: 2_000_000_000,
  maxEntries: 1_000,
  maxEntryUncompressedBytes: 500_000_000,
  maxTotalUncompressedBytes: 2_000_000_000,
  maxCentralDirectoryBytes: 2_000_000,
  maxPathBytes: 512,
  maxCompressionRatio: 200,
});

const ATTACHED_ONLY_GATES = {
  ota_preview_rollback: [
    "OTA_PRODUCTION_RUN_ID",
    "ota_production",
    "OTA publish evidence is attached; device signature/rollback drill still requires review.",
  ],
  cloudflare_preview_rollback: [
    "CLOUDFLARE_PRODUCTION_RUN_ID",
    "cloudflare_production",
    "Worker deploy evidence is attached; smoke/rollback drill still requires review.",
  ],
};

const MANUAL_GATE_IDS = new Set([
  "real_devices_and_push",
  "ota_preview_rollback",
  "cloudflare_preview_rollback",
  "backup_restore",
  "monitoring_slo",
  "store_console",
]);

function repositoryPath(repositoryRoot, path) {
  const value = relative(repositoryRoot, path).split(sep).join("/");
  if (!value || value === ".." || value.startsWith("../")) {
    throw new Error(`Evidence path is outside the repository: ${path}`);
  }
  return value;
}

function listAbsoluteRegularFiles(directory) {
  if (!existsSync(directory)) return [];
  if (!lstatSync(directory).isDirectory()) {
    throw new Error(`Evidence location is not a directory: ${directory}`);
  }
  const output = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Symbolic links are not accepted as evidence: ${child}`,
        );
      }
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile()) output.push(child);
      else throw new Error(`Evidence is not a regular file: ${child}`);
    }
  };
  visit(directory);
  return output.sort();
}

function listRegularFiles(repositoryRoot, directory) {
  return listAbsoluteRegularFiles(directory).map((path) =>
    repositoryPath(repositoryRoot, path),
  );
}

function requireDirectory(path, label) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} is not a regular directory: ${path}`);
  }
  return path;
}

function requireFile(
  path,
  label,
  { minBytes = 1, maxBytes = 64_000_000 } = {},
) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size < minBytes ||
    stat.size > maxBytes
  ) {
    throw new Error(`${label} is not a bounded regular file: ${path}`);
  }
  return path;
}

function readJson(path, label, options) {
  requireFile(path, label, options);
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("root must be an object");
    }
    return value;
  } catch (error) {
    throw new Error(
      `Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readText(path, label, options) {
  requireFile(path, label, options);
  return readFileSync(path, "utf8");
}

function artifactDirectory(artifactRoot, runKey, artifactName) {
  return requireDirectory(
    resolve(artifactRoot, runKey, artifactName),
    `${runKey}/${artifactName} artifact`,
  );
}

function relativeFiles(directory) {
  return listAbsoluteRegularFiles(directory).map((path) =>
    relative(directory, path).split(sep).join("/"),
  );
}

function requireExactFileSet(directory, expected, label) {
  const actual = relativeFiles(directory);
  if (!sameStringSet(actual, expected)) {
    throw new Error(`${label} file set does not match its exact contract.`);
  }
}

function requirePrefixedFileSet(directory, { required, extraPrefix, label }) {
  const actual = relativeFiles(directory);
  if (
    required.some((path) => !actual.includes(path)) ||
    actual.some(
      (path) => !required.includes(path) && !path.startsWith(extraPrefix),
    ) ||
    !actual.some((path) => path.startsWith(extraPrefix))
  ) {
    throw new Error(`${label} file set does not match its exact contract.`);
  }
}

function requireArchiveMagic(path, label, minBytes = 100_000) {
  requireFile(path, label, { minBytes, maxBytes: 2_000_000_000 });
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    if (readSync(file, header, 0, header.length, 0) !== header.length) {
      throw new Error(`${label} header is truncated.`);
    }
    if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      throw new Error(`${label} is not a ZIP-based artifact.`);
    }
  } finally {
    closeSync(file);
  }
}

function artifactEvidencePaths(repositoryRoot, metadataPath, directories) {
  return [
    repositoryPath(repositoryRoot, metadataPath),
    ...directories.flatMap((directory) =>
      listRegularFiles(repositoryRoot, directory),
    ),
  ].sort();
}

function validateRunMetadata({
  artifactRoot,
  runKey,
  runId,
  targetSha,
  environment,
}) {
  const contract = RUN_CONTRACTS[runKey];
  const path = resolve(artifactRoot, "run-metadata", `${runKey}.json`);
  const run = readJson(path, `${runKey} run metadata`);
  const expectedRepository = environment.GITHUB_REPOSITORY;
  const actualRepository = run.repository?.full_name;
  if (
    !/^[1-9][0-9]*$/u.test(String(runId)) ||
    !Number.isSafeInteger(run.id) ||
    run.id < 1 ||
    String(run.id) !== String(runId) ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_sha !== targetSha ||
    run.path !== `.github/workflows/${contract.workflow}` ||
    !contract.events.includes(run.event) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    typeof actualRepository !== "string" ||
    !actualRepository ||
    run.head_repository?.full_name !== actualRepository ||
    (expectedRepository && actualRepository !== expectedRepository)
  ) {
    throw new Error(
      `${runKey} run metadata does not satisfy its exact contract.`,
    );
  }
  return { path, run };
}

function validateEvidenceMetadata(
  path,
  { targetSha, runId, runAttempt, workflow, job, targetVus },
) {
  const metadata = readJson(path, `${job} evidence metadata`);
  if (
    metadata.schemaVersion !== 1 ||
    metadata.targetSha !== targetSha ||
    String(metadata.runId) !== String(runId) ||
    metadata.runAttempt !== runAttempt ||
    metadata.workflow !== `.github/workflows/${workflow}` ||
    metadata.job !== job ||
    (targetVus !== undefined && metadata.targetVus !== targetVus)
  ) {
    throw new Error(
      `${job} evidence metadata does not match the workflow run.`,
    );
  }
}

function checksum(path) {
  const hash = createHash("sha256");
  const file = openSync(path, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytes;
    do {
      bytes = readSync(file, buffer, 0, buffer.length, null);
      if (bytes > 0) hash.update(buffer.subarray(0, bytes));
    } while (bytes > 0);
  } finally {
    closeSync(file);
  }
  return hash.digest("hex");
}

function validateChecksumManifest(
  artifactRoot,
  manifestRelativePath,
  { logicalPrefix = "" } = {},
) {
  const manifestPath = resolve(artifactRoot, manifestRelativePath);
  const text = readText(manifestPath, "SHA256SUMS", {
    maxBytes: 2_000_000,
  });
  const entries = new Map();
  for (const line of text.trimEnd().split(/\r?\n/u)) {
    const match = line.match(/^([0-9a-f]{64}) [ *](.+)$/u);
    if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
    const logicalPath = match[2];
    const segments = logicalPath.split("/");
    if (
      logicalPath.startsWith("/") ||
      logicalPath.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(logicalPath) ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      ) ||
      entries.has(logicalPath)
    ) {
      throw new Error(`Unsafe or duplicate SHA256SUMS path: ${logicalPath}`);
    }
    if (logicalPrefix && !logicalPath.startsWith(logicalPrefix)) {
      throw new Error(
        `SHA256SUMS path is outside ${logicalPrefix}: ${logicalPath}`,
      );
    }
    const physicalRelativePath = logicalPrefix
      ? logicalPath.slice(logicalPrefix.length)
      : logicalPath;
    const absolute = resolve(artifactRoot, physicalRelativePath);
    const scoped = relative(artifactRoot, absolute).split(sep).join("/");
    if (!scoped || scoped === ".." || scoped.startsWith("../")) {
      throw new Error(`Out-of-scope SHA256SUMS path: ${logicalPath}`);
    }
    requireFile(absolute, `checksummed file ${logicalPath}`, {
      maxBytes: 2_000_000_000,
    });
    if (checksum(absolute) !== match[1]) {
      throw new Error(`SHA256 mismatch for ${logicalPath}`);
    }
    entries.set(logicalPath, absolute);
  }

  const expected = listAbsoluteRegularFiles(artifactRoot)
    .filter((path) => path !== manifestPath)
    .map((path) => {
      const physical = relative(artifactRoot, path).split(sep).join("/");
      return `${logicalPrefix}${physical}`;
    })
    .sort();
  if (
    expected.length !== entries.size ||
    expected.some((path) => !entries.has(path))
  ) {
    throw new Error("SHA256SUMS must cover every evidence file exactly once.");
  }
}

function validateMobileCi(context) {
  const sbomDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "etkinlink-mobile-sbom",
  );
  const debugDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "etkinlink-debug-apk",
  );
  requireExactFileSet(
    sbomDirectory,
    ["mobile-sbom.cdx.json"],
    "Mobile SBOM artifact",
  );
  requireExactFileSet(
    debugDirectory,
    ["app-debug.apk"],
    "Android debug artifact",
  );
  const sbom = readJson(
    resolve(sbomDirectory, "mobile-sbom.cdx.json"),
    "CycloneDX mobile SBOM",
    { maxBytes: 64_000_000 },
  );
  if (
    sbom.bomFormat !== "CycloneDX" ||
    typeof sbom.specVersion !== "string" ||
    !/^1\.[4-9]$/u.test(sbom.specVersion) ||
    sbom.version !== 1 ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  ) {
    throw new Error("Mobile SBOM is not a populated CycloneDX document.");
  }
  requireArchiveMagic(
    resolve(debugDirectory, "app-debug.apk"),
    "Android debug APK",
  );
  return [sbomDirectory, debugDirectory];
}

function validateDatabaseRls(context) {
  const directory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "local-database-security-evidence",
  );
  requireExactFileSet(
    directory,
    ["db-lint.txt", "db-start.txt", "pgtap.txt"],
    "Local database security artifact",
  );
  const started = readText(resolve(directory, "db-start.txt"), "DB start log");
  const lint = readText(resolve(directory, "db-lint.txt"), "DB lint log");
  const pgTap = readText(resolve(directory, "pgtap.txt"), "pgTAP log", {
    maxBytes: 64_000_000,
  });
  if (
    !/(?:Starting database|Applying migration|Started supabase)/iu.test(started)
  ) {
    throw new Error("DB start evidence does not show local database startup.");
  }
  if (!/No schema errors found/iu.test(lint)) {
    throw new Error(
      "DB lint evidence does not contain a completed lint result.",
    );
  }
  if (
    !/(?:Result:\s*PASS|All tests successful)/iu.test(pgTap) ||
    /(?:\bnot ok\b|Result:\s*FAIL)/iu.test(pgTap)
  ) {
    throw new Error("pgTAP evidence is not an unambiguous passing result.");
  }
  return [directory];
}

function validateStagingE2e(context) {
  const maestroDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "android-maestro-evidence",
  );
  const backendDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "staging-critical-backend-e2e-evidence",
  );
  requirePrefixedFileSet(maestroDirectory, {
    required: [
      "artifacts/e2e/android-maestro/SHA256SUMS",
      "artifacts/e2e/android-maestro/metadata.json",
      "mobile/e2e-results.xml",
    ],
    extraPrefix: "mobile/e2e-debug/",
    label: "Maestro evidence artifact",
  });
  requireExactFileSet(
    backendDirectory,
    [
      "artifacts/e2e/backend-critical-flows/SHA256SUMS",
      "artifacts/e2e/backend-critical-flows/metadata.json",
      "mobile/artifacts/staging-critical-e2e.json",
    ],
    "Backend E2E evidence artifact",
  );
  const junit = readText(
    resolve(maestroDirectory, "mobile/e2e-results.xml"),
    "Maestro JUnit evidence",
    { maxBytes: 64_000_000 },
  );
  if (
    !/<testsuites?\b/iu.test(junit) ||
    /\b(?:failures|errors)=["'][1-9][0-9]*["']/iu.test(junit) ||
    /<(?:failure|error)\b/iu.test(junit)
  ) {
    throw new Error("Maestro JUnit evidence is missing or reports failures.");
  }
  const debugDirectory = requireDirectory(
    resolve(maestroDirectory, "mobile/e2e-debug"),
    "Maestro debug evidence",
  );
  if (listAbsoluteRegularFiles(debugDirectory).length === 0) {
    throw new Error("Maestro debug evidence is empty.");
  }
  const maestroMetadata = resolve(
    maestroDirectory,
    "artifacts/e2e/android-maestro/metadata.json",
  );
  validateEvidenceMetadata(maestroMetadata, {
    targetSha: context.targetSha,
    runId: context.runId,
    runAttempt: context.run.run_attempt,
    workflow: "mobile-e2e.yml",
    job: "android-maestro",
  });
  validateChecksumManifest(
    maestroDirectory,
    "artifacts/e2e/android-maestro/SHA256SUMS",
  );

  const backendEvidence = readJson(
    resolve(backendDirectory, "mobile/artifacts/staging-critical-e2e.json"),
    "staging backend E2E evidence",
    { maxBytes: 64_000_000 },
  );
  if (
    backendEvidence.status !== "passed" ||
    !Array.isArray(backendEvidence.evidence) ||
    backendEvidence.evidence.length === 0 ||
    backendEvidence.evidence.some((item) => item?.status !== "passed")
  ) {
    throw new Error("Staging backend E2E evidence is not fully passing.");
  }
  const backendMetadata = resolve(
    backendDirectory,
    "artifacts/e2e/backend-critical-flows/metadata.json",
  );
  validateEvidenceMetadata(backendMetadata, {
    targetSha: context.targetSha,
    runId: context.runId,
    runAttempt: context.run.run_attempt,
    workflow: "mobile-e2e.yml",
    job: "backend-critical-flows",
  });
  validateChecksumManifest(
    backendDirectory,
    "artifacts/e2e/backend-critical-flows/SHA256SUMS",
  );
  return [maestroDirectory, backendDirectory];
}

function validateK6Summary(path, label) {
  const summary = readJson(path, label, { maxBytes: 128_000_000 });
  if (
    !summary.metrics ||
    typeof summary.metrics !== "object" ||
    !summary.root_group ||
    typeof summary.root_group !== "object" ||
    !Number.isFinite(summary.metrics.iterations?.values?.count) ||
    summary.metrics.iterations.values.count <= 0 ||
    !Number.isFinite(summary.metrics.http_reqs?.values?.count) ||
    summary.metrics.http_reqs.values.count <= 0
  ) {
    throw new Error(`${label} is not a complete k6 summary.`);
  }
  for (const metricName of ["http_req_failed", "http_req_duration", "checks"]) {
    const thresholds = summary.metrics[metricName]?.thresholds;
    if (
      !thresholds ||
      typeof thresholds !== "object" ||
      Object.keys(thresholds).length === 0 ||
      Object.values(thresholds).some((threshold) => threshold?.ok !== true)
    ) {
      throw new Error(
        `${label} does not contain passing ${metricName} thresholds.`,
      );
    }
  }
}

function validateStagingLoad(context) {
  const directory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "staging-mixed-load-evidence-10000vu",
  );
  requireExactFileSet(
    directory,
    [
      "SHA256SUMS",
      "load-evidence-metadata.json",
      "load-low-25vu.json",
      "load-medium-250vu.json",
      "load-target-10000vu.json",
    ],
    "10000 VU load evidence artifact",
  );
  for (const [name, label] of [
    ["load-low-25vu.json", "25 VU k6 summary"],
    ["load-medium-250vu.json", "250 VU k6 summary"],
    ["load-target-10000vu.json", "10000 VU k6 summary"],
  ]) {
    validateK6Summary(resolve(directory, name), label);
  }
  validateEvidenceMetadata(resolve(directory, "load-evidence-metadata.json"), {
    targetSha: context.targetSha,
    runId: context.runId,
    runAttempt: context.run.run_attempt,
    workflow: "staging-load-test.yml",
    job: "staged-load-test",
    targetVus: 10_000,
  });
  validateChecksumManifest(directory, "SHA256SUMS", {
    logicalPrefix: "artifacts/",
  });
  return [directory];
}

function validateSignerEvidence(path, platform, targetSha) {
  const signer = readJson(path, `${platform} signer identity`);
  if (
    signer.schemaVersion !== 1 ||
    signer.targetSha !== targetSha ||
    signer.platform !== platform ||
    !Number.isFinite(Date.parse(signer.verifiedAt))
  ) {
    throw new Error(`${platform} signer identity is not bound to target SHA.`);
  }
  if (
    platform === "android" &&
    (!/^[0-9A-F]{64}$/u.test(signer.expectedSigningCertificateSha256) ||
      signer.actualSigningCertificateSha256 !==
        signer.expectedSigningCertificateSha256 ||
      typeof signer.certificateSubject !== "string" ||
      !signer.certificateSubject ||
      typeof signer.certificateIssuer !== "string" ||
      !signer.certificateIssuer ||
      typeof signer.certificateSerialNumber !== "string" ||
      !signer.certificateSerialNumber ||
      !Number.isFinite(Date.parse(signer.certificateValidFrom)) ||
      !Number.isFinite(Date.parse(signer.certificateValidTo)))
  ) {
    throw new Error("Android signer fingerprint evidence is invalid.");
  }
  if (
    platform === "ios" &&
    (!/^[0-9A-Z]{10}$/u.test(signer.expectedTeamId) ||
      signer.codesignTeamId !== signer.expectedTeamId ||
      signer.entitlementTeamId !== signer.expectedTeamId ||
      signer.bundleIdentifier !== "com.etkinlink.app" ||
      signer.applicationIdentifier !==
        `${signer.expectedTeamId}.${signer.bundleIdentifier}`)
  ) {
    throw new Error("iOS signer Team ID evidence is invalid.");
  }
}

function sameStringSet(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function validatePrerequisiteArtifact(
  artifact,
  requirement,
  evidence,
  targetSha,
) {
  if (
    !artifact ||
    typeof artifact !== "object" ||
    artifact.name !== requirement.name ||
    !Number.isSafeInteger(artifact.id) ||
    artifact.id < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(artifact.archiveDigest ?? "") ||
    !Number.isSafeInteger(artifact.archiveBytes) ||
    artifact.archiveBytes < 1 ||
    !Number.isSafeInteger(artifact.uncompressedBytes) ||
    artifact.uncompressedBytes < 1 ||
    !Array.isArray(artifact.files) ||
    artifact.files.length === 0 ||
    new Set(artifact.files).size !== artifact.files.length ||
    !artifact.contentDigests ||
    typeof artifact.contentDigests !== "object" ||
    Array.isArray(artifact.contentDigests)
  ) {
    throw new Error(
      `Mobile release prerequisite artifact is invalid: ${requirement.name}.`,
    );
  }
  for (const path of artifact.files) {
    const segments = typeof path === "string" ? path.split("/") : [];
    if (
      segments.length === 0 ||
      path.startsWith("/") ||
      path.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      segments.some(
        (segment) => !segment || segment === "." || segment === "..",
      ) ||
      !/^sha256:[0-9a-f]{64}$/u.test(artifact.contentDigests[path] ?? "")
    ) {
      throw new Error(`Invalid prerequisite artifact file: ${String(path)}.`);
    }
  }
  if (
    !sameStringSet(Object.keys(artifact.contentDigests), artifact.files) ||
    (requirement.exactFiles &&
      !sameStringSet(artifact.files, requirement.exactFiles)) ||
    (requirement.requiredFiles &&
      requirement.requiredFiles.some(
        (path) => !artifact.files.includes(path),
      )) ||
    (requirement.extraPrefix &&
      artifact.files.some(
        (path) =>
          !requirement.requiredFiles.includes(path) &&
          !path.startsWith(requirement.extraPrefix),
      )) ||
    (requirement.extraPrefix &&
      !artifact.files.some((path) => path.startsWith(requirement.extraPrefix)))
  ) {
    throw new Error(
      `Prerequisite artifact file set is invalid: ${requirement.name}.`,
    );
  }
  if (requirement.metadata) {
    const metadata = artifact.metadata;
    if (
      !metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      metadata.schemaVersion !== 1 ||
      metadata.targetSha !== targetSha ||
      String(metadata.runId) !== String(evidence.runId) ||
      metadata.runAttempt !== evidence.runAttempt ||
      metadata.workflow !== requirement.metadata.workflow ||
      metadata.job !== requirement.metadata.job ||
      (requirement.metadata.targetVus !== undefined &&
        metadata.targetVus !== requirement.metadata.targetVus)
    ) {
      throw new Error(
        `Prerequisite artifact metadata is invalid: ${requirement.name}.`,
      );
    }
  }
}

function validateMobileRelease(context) {
  const prerequisiteDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "release-prerequisite-evidence",
  );
  const androidDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "etkinlink-production-aab",
  );
  const iosDirectory = artifactDirectory(
    context.artifactRoot,
    context.runKey,
    "etkinlink-production-ipa-evidence",
  );
  requireExactFileSet(
    prerequisiteDirectory,
    ["release-prerequisite-evidence.json"],
    "Mobile release prerequisite artifact",
  );
  requireExactFileSet(
    androidDirectory,
    [
      "android/app/build/outputs/bundle/release/app-release.aab",
      "android/app/build/outputs/mapping/release/mapping.txt",
      "artifacts/android-signer-identity.json",
    ],
    "Android production artifact",
  );
  requireExactFileSet(
    iosDirectory,
    [
      "artifacts/EtkinLink.ipa",
      "artifacts/PrivacyInfo.xcprivacy",
      "artifacts/ios-entitlements.plist",
      "artifacts/ios-signer-identity.json",
      "eas-ios-build.json",
    ],
    "iOS production artifact",
  );
  const prerequisite = readJson(
    resolve(prerequisiteDirectory, "release-prerequisite-evidence.json"),
    "mobile release prerequisite evidence",
    { maxBytes: 16_000_000 },
  );
  const prerequisitesByWorkflow = new Map(
    Array.isArray(prerequisite.evidence)
      ? prerequisite.evidence.map((item) => [item?.workflow, item])
      : [],
  );
  const requiredPrerequisites = {
    "mobile-ci.yml": {
      events: ["push"],
      artifacts: [
        {
          name: "etkinlink-mobile-sbom",
          exactFiles: ["mobile-sbom.cdx.json"],
        },
        { name: "etkinlink-debug-apk", exactFiles: ["app-debug.apk"] },
        {
          name: "local-database-security-evidence",
          exactFiles: ["db-lint.txt", "db-start.txt", "pgtap.txt"],
        },
      ],
    },
    "mobile-e2e.yml": {
      events: ["schedule", "workflow_dispatch"],
      artifacts: [
        {
          name: "android-maestro-evidence",
          requiredFiles: [
            "artifacts/e2e/android-maestro/SHA256SUMS",
            "artifacts/e2e/android-maestro/metadata.json",
            "mobile/e2e-results.xml",
          ],
          extraPrefix: "mobile/e2e-debug/",
          metadata: {
            workflow: ".github/workflows/mobile-e2e.yml",
            job: "android-maestro",
          },
        },
        {
          name: "staging-critical-backend-e2e-evidence",
          exactFiles: [
            "artifacts/e2e/backend-critical-flows/SHA256SUMS",
            "artifacts/e2e/backend-critical-flows/metadata.json",
            "mobile/artifacts/staging-critical-e2e.json",
          ],
          metadata: {
            workflow: ".github/workflows/mobile-e2e.yml",
            job: "backend-critical-flows",
          },
        },
      ],
    },
    "staging-load-test.yml": {
      events: ["workflow_dispatch"],
      artifacts: [
        {
          name: "staging-mixed-load-evidence-10000vu",
          exactFiles: [
            "SHA256SUMS",
            "load-evidence-metadata.json",
            "load-low-25vu.json",
            "load-medium-250vu.json",
            "load-target-10000vu.json",
          ],
          metadata: {
            workflow: ".github/workflows/staging-load-test.yml",
            job: "staged-load-test",
            targetVus: 10_000,
          },
        },
      ],
    },
  };
  if (
    prerequisite.schemaVersion !== 2 ||
    prerequisite.commit !== context.targetSha ||
    !Number.isFinite(Date.parse(prerequisite.checkedAt)) ||
    prerequisitesByWorkflow.size !== Object.keys(requiredPrerequisites).length
  ) {
    throw new Error("Mobile release prerequisite evidence is incomplete.");
  }
  for (const [workflow, requirement] of Object.entries(requiredPrerequisites)) {
    const evidence = prerequisitesByWorkflow.get(workflow);
    const artifactNames = Array.isArray(evidence?.artifacts)
      ? evidence.artifacts.map((artifact) => artifact?.name)
      : [];
    const expectedNames = requirement.artifacts.map(
      (artifact) => artifact.name,
    );
    if (
      evidence?.headSha !== context.targetSha ||
      !Number.isSafeInteger(evidence.runId) ||
      !Number.isSafeInteger(evidence.runAttempt) ||
      evidence.runAttempt < 1 ||
      !Number.isFinite(Date.parse(evidence.completedAt)) ||
      !/^https:\/\/github\.com\//u.test(evidence.runUrl ?? "") ||
      !requirement.events.includes(evidence.event) ||
      !Array.isArray(evidence.artifacts) ||
      !sameStringSet(artifactNames, expectedNames)
    ) {
      throw new Error(
        `Mobile release prerequisite is invalid for ${workflow}.`,
      );
    }
    for (const artifactRequirement of requirement.artifacts) {
      validatePrerequisiteArtifact(
        evidence.artifacts.find(
          (artifact) => artifact.name === artifactRequirement.name,
        ),
        artifactRequirement,
        evidence,
        context.targetSha,
      );
    }
  }
  requireArchiveMagic(
    resolve(
      androidDirectory,
      "android/app/build/outputs/bundle/release/app-release.aab",
    ),
    "signed Android AAB",
    1_000_000,
  );
  requireFile(
    resolve(
      androidDirectory,
      "android/app/build/outputs/mapping/release/mapping.txt",
    ),
    "Android R8 mapping",
    { minBytes: 100, maxBytes: 500_000_000 },
  );
  validateSignerEvidence(
    resolve(androidDirectory, "artifacts/android-signer-identity.json"),
    "android",
    context.targetSha,
  );

  requireArchiveMagic(
    resolve(iosDirectory, "artifacts/EtkinLink.ipa"),
    "signed iOS IPA",
    1_000_000,
  );
  const entitlements = readText(
    resolve(iosDirectory, "artifacts/ios-entitlements.plist"),
    "iOS signed entitlements",
  );
  if (
    !/<key>aps-environment<\/key>\s*<string>production<\/string>/iu.test(
      entitlements,
    ) ||
    !/<key>com\.apple\.developer\.team-identifier<\/key>/u.test(entitlements) ||
    !/<key>application-identifier<\/key>/u.test(entitlements)
  ) {
    throw new Error("iOS signed entitlements evidence is incomplete.");
  }
  validateSignerEvidence(
    resolve(iosDirectory, "artifacts/ios-signer-identity.json"),
    "ios",
    context.targetSha,
  );
  const privacy = readText(
    resolve(iosDirectory, "artifacts/PrivacyInfo.xcprivacy"),
    "iOS privacy manifest",
  );
  if (!/<key>NSPrivacy/u.test(privacy)) {
    throw new Error("iOS privacy manifest evidence is invalid.");
  }
  const easPath = resolve(iosDirectory, "eas-ios-build.json");
  const easText = readText(easPath, "EAS iOS build result", {
    maxBytes: 16_000_000,
  });
  let easPayload;
  try {
    easPayload = JSON.parse(easText);
  } catch (error) {
    throw new Error(
      `Invalid EAS iOS build result: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const build = Array.isArray(easPayload) ? easPayload[0] : undefined;
  let buildUrl;
  try {
    buildUrl = new URL(build?.artifacts?.buildUrl);
  } catch {
    buildUrl = undefined;
  }
  if (
    !Array.isArray(easPayload) ||
    easPayload.length !== 1 ||
    !build ||
    typeof build !== "object" ||
    build.status !== "FINISHED" ||
    build.platform !== "IOS" ||
    build.buildProfile !== "production" ||
    build.distribution !== "STORE" ||
    build.isForIosSimulator !== false ||
    build.updateChannel?.name !== "production" ||
    build.gitCommitHash !== context.targetSha ||
    typeof build.id !== "string" ||
    build.id.length < 8 ||
    !buildUrl ||
    buildUrl.protocol !== "https:" ||
    buildUrl.username ||
    buildUrl.password ||
    (buildUrl.hostname !== "expo.dev" &&
      !buildUrl.hostname.endsWith(".expo.dev"))
  ) {
    throw new Error(
      "EAS iOS build result is not a finished same-SHA production build.",
    );
  }
  return [prerequisiteDirectory, androidDirectory, iosDirectory];
}

function readFileRange(file, length, position, label) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytes = readSync(
      file,
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytes === 0) throw new Error(`Truncated manual evidence ZIP ${label}.`);
    offset += bytes;
  }
  return buffer;
}

function safeZipEntryName(rawName, maxPathBytes) {
  if (rawName.length === 0 || rawName.length > maxPathBytes) {
    throw new Error("Manual evidence ZIP contains an empty or overlong path.");
  }
  const name = rawName.toString("utf8");
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = normalized.split("/");
  if (
    !normalized ||
    !SAFE_PATH_PATTERN.test(name) ||
    name.startsWith("/") ||
    name.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe manual evidence ZIP path: ${name}`);
  }
  return name;
}

function findEndOfCentralDirectory(tail) {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentBytes = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentBytes === tail.length) return offset;
  }
  throw new Error("Manual evidence ZIP end record is missing or malformed.");
}

export function validateManualEvidenceZip(path, limits = MANUAL_ZIP_LIMITS) {
  const effective = { ...MANUAL_ZIP_LIMITS, ...limits };
  const file = openSync(path, "r");
  try {
    const stat = fstatSync(file);
    if (
      !stat.isFile() ||
      stat.size < 22 ||
      stat.size > effective.maxCompressedBytes
    ) {
      throw new Error("Manual evidence ZIP compressed size is out of bounds.");
    }
    const tailLength = Math.min(stat.size, 65_557);
    const tailPosition = stat.size - tailLength;
    const tail = readFileRange(file, tailLength, tailPosition, "tail");
    const eocdOffset = findEndOfCentralDirectory(tail);
    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDisk = tail.readUInt16LE(eocdOffset + 6);
    const diskEntries = tail.readUInt16LE(eocdOffset + 8);
    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralBytes = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    const absoluteEocdOffset = tailPosition + eocdOffset;
    if (
      diskNumber !== 0 ||
      centralDisk !== 0 ||
      diskEntries !== totalEntries ||
      totalEntries === 0 ||
      totalEntries === 0xffff ||
      totalEntries > effective.maxEntries ||
      centralBytes === 0xffffffff ||
      centralOffset === 0xffffffff ||
      centralBytes > effective.maxCentralDirectoryBytes ||
      centralOffset + centralBytes !== absoluteEocdOffset
    ) {
      throw new Error(
        "Manual evidence ZIP is multi-disk, ZIP64, empty, oversized, or structurally invalid.",
      );
    }

    const central = readFileRange(
      file,
      centralBytes,
      centralOffset,
      "central directory",
    );
    const entries = [];
    const names = new Set();
    const portableNames = new Set();
    const localOffsets = new Set();
    let cursor = 0;
    let totalUncompressedBytes = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (
        cursor + 46 > central.length ||
        central.readUInt32LE(cursor) !== 0x02014b50
      ) {
        throw new Error("Manual evidence ZIP central directory is truncated.");
      }
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedBytes = central.readUInt32LE(cursor + 20);
      const uncompressedBytes = central.readUInt32LE(cursor + 24);
      const nameBytes = central.readUInt16LE(cursor + 28);
      const extraBytes = central.readUInt16LE(cursor + 30);
      const commentBytes = central.readUInt16LE(cursor + 32);
      const startDisk = central.readUInt16LE(cursor + 34);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localOffset = central.readUInt32LE(cursor + 42);
      const end = cursor + 46 + nameBytes + extraBytes + commentBytes;
      if (
        end > central.length ||
        startDisk !== 0 ||
        (flags & 0x0041) !== 0 ||
        (method !== 0 && method !== 8) ||
        compressedBytes === 0xffffffff ||
        uncompressedBytes === 0xffffffff ||
        localOffset === 0xffffffff
      ) {
        throw new Error(
          "Manual evidence ZIP contains encrypted, ZIP64, or malformed entries.",
        );
      }
      const name = safeZipEntryName(
        central.subarray(cursor + 46, cursor + 46 + nameBytes),
        effective.maxPathBytes,
      );
      const portableName = name.toLowerCase();
      if (
        names.has(name) ||
        portableNames.has(portableName) ||
        localOffsets.has(localOffset)
      ) {
        throw new Error("Manual evidence ZIP contains duplicate entries.");
      }
      names.add(name);
      portableNames.add(portableName);
      localOffsets.add(localOffset);

      const unixMode = externalAttributes >>> 16;
      const fileType = unixMode & 0xf000;
      const dosDirectory = (externalAttributes & 0x10) !== 0;
      const isDirectory =
        name.endsWith("/") || dosDirectory || fileType === 0x4000;
      if (
        fileType === 0xa000 ||
        (fileType !== 0 && fileType !== 0x4000 && fileType !== 0x8000) ||
        (isDirectory && uncompressedBytes !== 0)
      ) {
        throw new Error(
          "Manual evidence ZIP contains a symlink or unsupported special entry.",
        );
      }
      if (
        uncompressedBytes > effective.maxEntryUncompressedBytes ||
        totalUncompressedBytes + uncompressedBytes >
          effective.maxTotalUncompressedBytes
      ) {
        throw new Error(
          "Manual evidence ZIP uncompressed size exceeds its safety limit.",
        );
      }
      if (
        method === 8 &&
        uncompressedBytes > 0 &&
        (compressedBytes === 0 ||
          uncompressedBytes / compressedBytes > effective.maxCompressionRatio)
      ) {
        throw new Error(
          "Manual evidence ZIP compression ratio exceeds its safety limit.",
        );
      }
      totalUncompressedBytes += uncompressedBytes;
      entries.push({
        name,
        flags,
        method,
        compressedBytes,
        localOffset,
        isDirectory,
      });
      cursor = end;
    }
    if (cursor !== central.length) {
      throw new Error(
        "Manual evidence ZIP has unparsed central directory data.",
      );
    }

    for (const entry of entries) {
      const local = readFileRange(file, 30, entry.localOffset, "local header");
      if (local.readUInt32LE(0) !== 0x04034b50) {
        throw new Error("Manual evidence ZIP local header is invalid.");
      }
      const localFlags = local.readUInt16LE(6);
      const localMethod = local.readUInt16LE(8);
      const localNameBytes = local.readUInt16LE(26);
      const localExtraBytes = local.readUInt16LE(28);
      const localName = safeZipEntryName(
        readFileRange(
          file,
          localNameBytes,
          entry.localOffset + 30,
          "local path",
        ),
        effective.maxPathBytes,
      );
      const dataOffset =
        entry.localOffset + 30 + localNameBytes + localExtraBytes;
      if (
        (localFlags & 0x0041) !== 0 ||
        localFlags !== entry.flags ||
        localMethod !== entry.method ||
        localName !== entry.name ||
        dataOffset + entry.compressedBytes > centralOffset
      ) {
        throw new Error(
          "Manual evidence ZIP local and central entry records do not match.",
        );
      }
    }

    const files = entries.filter((entry) => !entry.isDirectory);
    for (const fileEntry of files) {
      if (
        entries.some(
          (entry) =>
            entry.name !== fileEntry.name &&
            entry.name.startsWith(`${fileEntry.name}/`),
        )
      ) {
        throw new Error(
          "Manual evidence ZIP contains a file/directory path collision.",
        );
      }
    }
    return {
      entries: totalEntries,
      compressedBytes: stat.size,
      totalUncompressedBytes,
    };
  } finally {
    closeSync(file);
  }
}

function resolveManualEvidenceFile(gateRoot, path, gateId) {
  if (typeof path !== "string" || !SAFE_PATH_PATTERN.test(path)) {
    throw new Error(`Unsafe manual evidence path for ${gateId}.`);
  }
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe manual evidence path for ${gateId}: ${path}`);
  }
  const absolute = resolve(gateRoot, path);
  const scoped = relative(gateRoot, absolute).split(sep).join("/");
  if (!scoped || scoped === ".." || scoped.startsWith("../")) {
    throw new Error(`Out-of-scope manual evidence for ${gateId}: ${path}`);
  }
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw new Error(`Missing manual evidence for ${gateId}: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(
      `Manual evidence is not a regular file for ${gateId}: ${path}`,
    );
  }
  return absolute;
}

export function validateManualAttestation(attestation, { gateId, targetSha }) {
  if (
    attestation?.schemaVersion !== 1 ||
    attestation.gateId !== gateId ||
    attestation.targetSha !== targetSha ||
    attestation.decision !== "approved" ||
    typeof attestation.reviewer !== "string" ||
    !attestation.reviewer.trim() ||
    typeof attestation.reviewedAt !== "string" ||
    !Number.isFinite(Date.parse(attestation.reviewedAt)) ||
    !Array.isArray(attestation.evidenceFiles) ||
    attestation.evidenceFiles.length === 0
  ) {
    throw new Error(`Invalid manual evidence attestation: ${gateId}`);
  }
  return attestation;
}

export function applyEvidenceClaims(
  document,
  {
    targetSha,
    repositoryRoot,
    artifactRoot,
    environment = process.env,
    manualReleaseTag = environment.MANUAL_EVIDENCE_RELEASE_TAG ?? "",
  },
) {
  if (!SHA_PATTERN.test(targetSha)) {
    throw new Error("Target SHA must be a full lowercase commit SHA.");
  }
  if (document?.schemaVersion !== 1 || !Array.isArray(document.gates)) {
    throw new Error(
      "Evidence claims must use schemaVersion 1 and a gates array.",
    );
  }

  for (const gate of document.gates) {
    const mapping = AUTOMATED_GATES[gate.id];
    if (!mapping || !environment[mapping.environmentKey]) continue;
    const runId = environment[mapping.environmentKey];
    const { path: runMetadataPath, run } = validateRunMetadata({
      artifactRoot,
      runKey: mapping.runKey,
      runId,
      targetSha,
      environment,
    });
    const directories = mapping.validate({
      artifactRoot,
      runKey: mapping.runKey,
      runId,
      run,
      targetSha,
    });
    const evidencePaths = artifactEvidencePaths(
      repositoryRoot,
      runMetadataPath,
      directories,
    );
    gate.status = "verified";
    gate.sameCommitSha = targetSha;
    gate.evidencePaths = evidencePaths;
    gate.note = `GitHub Actions run ${runId}; exact workflow, event, attempt, target SHA, artifact names, content and checksums validated.`;
  }

  for (const gate of document.gates) {
    const mapping = ATTACHED_ONLY_GATES[gate.id];
    if (!mapping || !environment[mapping[0]]) continue;
    const evidencePaths = listRegularFiles(
      repositoryRoot,
      resolve(artifactRoot, mapping[1]),
    );
    if (evidencePaths.length === 0) {
      throw new Error(`${gate.id} run has no downloaded artifacts.`);
    }
    gate.status = "attached";
    gate.sameCommitSha = targetSha;
    gate.evidencePaths = evidencePaths;
    gate.note = mapping[2];
  }

  if (!manualReleaseTag) return document;
  for (const gate of document.gates) {
    if (!MANUAL_GATE_IDS.has(gate.id)) continue;
    const gateRoot = resolve(artifactRoot, "manual", gate.id);
    const attestationPath = resolve(gateRoot, "attestation.json");
    if (!existsSync(attestationPath)) continue;

    let attestation;
    try {
      attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Unreadable manual evidence attestation for ${gate.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    validateManualAttestation(attestation, { gateId: gate.id, targetSha });
    const evidencePaths = [attestationPath];
    for (const path of attestation.evidenceFiles) {
      evidencePaths.push(resolveManualEvidenceFile(gateRoot, path, gate.id));
    }
    gate.status = "verified";
    gate.sameCommitSha = targetSha;
    gate.evidencePaths = [
      ...new Set(
        evidencePaths.map((path) => repositoryPath(repositoryRoot, path)),
      ),
    ];
    gate.note = `Reviewed manual evidence from release ${manualReleaseTag}; attestation and SHA validated.`;
  }
  return document;
}

export function writeEvidenceClaims({
  targetSha = process.env.TARGET_SHA,
  repositoryRoot = process.cwd(),
  inputPath = "release-evidence/evidence-status.json",
  artifactPath = "artifacts/evidence-input",
  outputPath = "artifacts/evidence-input/evidence-status.json",
  environment = process.env,
} = {}) {
  const root = resolve(repositoryRoot);
  const document = JSON.parse(readFileSync(resolve(root, inputPath), "utf8"));
  applyEvidenceClaims(document, {
    targetSha,
    repositoryRoot: root,
    artifactRoot: resolve(root, artifactPath),
    environment,
  });
  writeFileSync(
    resolve(root, outputPath),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  return document;
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    const zipOption = process.argv.find((value) =>
      value.startsWith("--validate-manual-zip="),
    );
    if (zipOption) {
      const path = zipOption.slice("--validate-manual-zip=".length);
      const result = validateManualEvidenceZip(resolve(path));
      console.log(
        `Manual evidence ZIP passed pre-extraction validation (${result.entries} entries, ${result.totalUncompressedBytes} uncompressed bytes).`,
      );
    } else {
      writeEvidenceClaims();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

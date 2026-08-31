import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;

const AUTOMATED_GATES = {
  mobile_ci: ["MOBILE_CI_RUN_ID", "mobile_ci"],
  database_rls: ["MOBILE_CI_RUN_ID", "mobile_ci"],
  staging_e2e: ["STAGING_E2E_RUN_ID", "staging_e2e"],
  staging_load: ["STAGING_LOAD_RUN_ID", "staging_load"],
  signed_android_ios: ["MOBILE_RELEASE_RUN_ID", "mobile_release"],
};

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

function listRegularFiles(repositoryRoot, directory) {
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
          `Symbolic links are not accepted as evidence: ${child}`
        );
      }
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile())
        output.push(repositoryPath(repositoryRoot, child));
    }
  };
  visit(directory);
  return output.sort();
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
      `Manual evidence is not a regular file for ${gateId}: ${path}`
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
  }
) {
  if (!SHA_PATTERN.test(targetSha)) {
    throw new Error("Target SHA must be a full lowercase commit SHA.");
  }
  if (document?.schemaVersion !== 1 || !Array.isArray(document.gates)) {
    throw new Error(
      "Evidence claims must use schemaVersion 1 and a gates array."
    );
  }

  for (const gate of document.gates) {
    const mapping = AUTOMATED_GATES[gate.id];
    if (!mapping || !environment[mapping[0]]) continue;
    const evidencePaths = listRegularFiles(
      repositoryRoot,
      resolve(artifactRoot, mapping[1])
    );
    if (evidencePaths.length === 0) {
      throw new Error(`${gate.id} run has no downloaded artifacts.`);
    }
    gate.status = "verified";
    gate.sameCommitSha = targetSha;
    gate.evidencePaths = evidencePaths;
    gate.note = `GitHub Actions run ${
      environment[mapping[0]]
    }; success and head SHA validated.`;
  }

  for (const gate of document.gates) {
    const mapping = ATTACHED_ONLY_GATES[gate.id];
    if (!mapping || !environment[mapping[0]]) continue;
    const evidencePaths = listRegularFiles(
      repositoryRoot,
      resolve(artifactRoot, mapping[1])
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
        }`
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
        evidencePaths.map((path) => repositoryPath(repositoryRoot, path))
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
    "utf8"
  );
  return document;
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    writeEvidenceClaims();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const ALLOWED_STATUSES = new Set(["missing", "attached", "verified"]);

function git(root, args) {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toRepositoryPath(root, path) {
  const value = relative(root, path).split(sep).join("/");
  if (!value || value === ".." || value.startsWith("../")) {
    throw new Error(`Evidence path is outside repository: ${path}`);
  }
  return value;
}

export function collectArtifacts(
  root,
  artifactDirectories,
  excludedPaths = [],
) {
  const excluded = new Set(excludedPaths.map((path) => resolve(path)));
  const files = [];
  const visit = (path) => {
    const absolute = resolve(path);
    if (excluded.has(absolute)) return;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Symbolic links are not accepted as release evidence: ${absolute}`,
      );
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort())
        visit(resolve(absolute, entry));
      return;
    }
    if (!stat.isFile()) return;
    files.push({
      path: toRepositoryPath(root, absolute),
      bytes: stat.size,
      sha256: sha256(absolute),
    });
  };
  for (const directory of artifactDirectories) visit(resolve(root, directory));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function validateClaims(claimsDocument, expectedSha, artifactPaths) {
  if (
    claimsDocument?.schemaVersion !== 1 ||
    !Array.isArray(claimsDocument.gates)
  ) {
    throw new Error(
      "Evidence claims must use schemaVersion 1 and a gates array.",
    );
  }
  const seen = new Set();
  return claimsDocument.gates.map((gate) => {
    if (!gate?.id || seen.has(gate.id))
      throw new Error("Evidence gate IDs must be unique.");
    seen.add(gate.id);
    if (!ALLOWED_STATUSES.has(gate.status)) {
      throw new Error(
        `Unsupported evidence status for ${gate.id}: ${gate.status}`,
      );
    }
    const evidencePaths = Array.isArray(gate.evidencePaths)
      ? gate.evidencePaths
      : [];
    if (gate.status === "verified") {
      if (gate.sameCommitSha !== expectedSha) {
        throw new Error(
          `${gate.id} is verified against a different or missing commit SHA.`,
        );
      }
      if (evidencePaths.length === 0) {
        throw new Error(`${gate.id} is verified without an evidence artifact.`);
      }
      for (const path of evidencePaths) {
        if (!artifactPaths.has(path))
          throw new Error(`${gate.id} references a missing artifact: ${path}`);
      }
    }
    return {
      id: gate.id,
      required: gate.required !== false,
      status: gate.status,
      sameCommitSha: gate.sameCommitSha ?? null,
      evidencePaths,
      note: String(gate.note ?? ""),
    };
  });
}

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function options(args, name) {
  return args.flatMap((value, index) =>
    value === `--${name}` ? [args[index + 1]] : [],
  );
}

export function generateManifest(args = process.argv.slice(2)) {
  const root = resolve(
    option(args, "repo-root") ??
      git(process.cwd(), ["rev-parse", "--show-toplevel"]),
  );
  const expectedSha = option(args, "expected-sha");
  const claimsPath = resolve(
    root,
    option(args, "claims") ?? "release-evidence/evidence-status.json",
  );
  const outputPath = resolve(
    root,
    option(args, "output") ?? "artifacts/release-evidence/manifest.json",
  );
  const checksumPath = resolve(dirname(outputPath), "SHA256SUMS.txt");
  const artifactDirectories = options(args, "artifact-dir");
  if (!expectedSha || !SHA_PATTERN.test(expectedSha))
    throw new Error("--expected-sha must be a full lowercase SHA.");
  if (artifactDirectories.length === 0)
    throw new Error("At least one --artifact-dir is required.");

  const actualSha = git(root, ["rev-parse", "HEAD"]);
  if (actualSha !== expectedSha)
    throw new Error(`Checkout SHA ${actualSha} does not match ${expectedSha}.`);
  const dirtyEntries = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ])
    .split(/\r?\n/u)
    .filter(Boolean);
  const artifacts = collectArtifacts(root, artifactDirectories, [
    outputPath,
    checksumPath,
  ]);
  const claims = validateClaims(
    JSON.parse(readFileSync(claimsPath, "utf8")),
    expectedSha,
    new Set(artifacts.map((artifact) => artifact.path)),
  );
  const required = claims.filter((claim) => claim.required);
  const allRequiredVerified = required.every(
    (claim) => claim.status === "verified",
  );
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? null,
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
    commitSha: actualSha,
    expectedSha,
    treeCleanBeforeGeneration: dirtyEntries.length === 0,
    dirtyEntriesBeforeGeneration: dirtyEntries,
    artifacts,
    gates: claims,
    summary: {
      required: required.length,
      verified: required.filter((claim) => claim.status === "verified").length,
      missing: required
        .filter((claim) => claim.status === "missing")
        .map((claim) => claim.id),
      attachedNotVerified: required
        .filter((claim) => claim.status === "attached")
        .map((claim) => claim.id),
    },
    releaseDecision:
      dirtyEntries.length === 0 && allRequiredVerified ? "GO" : "NO-GO",
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const checksumLines = [
    ...artifacts.map((artifact) => `${artifact.sha256}  ${artifact.path}`),
    `${sha256(outputPath)}  ${toRepositoryPath(root, outputPath)}`,
  ];
  writeFileSync(checksumPath, `${checksumLines.join("\n")}\n`, "utf8");
  return manifest;
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    const manifest = generateManifest();
    console.log(
      `Release evidence manifest: ${manifest.releaseDecision} (${manifest.commitSha})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

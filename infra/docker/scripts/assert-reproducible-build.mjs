/**
 * Asserts that every supplied OCI archive describes the same image, and records
 * the comparison as evidence.
 *
 * Two clean-cache builds of the tooling image used to disagree because
 * `SOURCE_DATE_EPOCH` alone only pins the config's `created` field and the
 * history stamps — the file mtimes inside the layers still came from the wall
 * clock, so `npm ci` produced different diffIDs on every run and therefore a
 * different image. The builds now export with `rewrite-timestamp=true`, which
 * is what actually normalises those mtimes, and this script compares the parts
 * of the artifact a reproducibility claim is about: the image manifest digest,
 * the config digest, the rootfs diffIDs and the image labels.
 *
 * Usage:
 *   node infra/docker/scripts/assert-reproducible-build.mjs \
 *     --evidence <path.json> <archive.tar> <archive.tar> [...]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectOciArchive } from "./inspect-oci-archive.mjs";

const argv = process.argv.slice(2);
const evidenceIndex = argv.indexOf("--evidence");
if (evidenceIndex === -1 || !argv[evidenceIndex + 1]) {
  throw new Error(
    "Usage: assert-reproducible-build.mjs --evidence <path.json> <archive.tar> <archive.tar> [...]",
  );
}
const evidencePath = argv[evidenceIndex + 1];
const archives = argv.filter(
  (value, index) => index !== evidenceIndex && index !== evidenceIndex + 1,
);
if (archives.length < 2) {
  throw new Error("At least two archives are required to prove reproducibility");
}

const inspected = [];
for (const archive of archives) {
  inspected.push({ archive, ...(await inspectOciArchive(archive)) });
}

const [reference] = inspected;
const differences = [];
for (const candidate of inspected.slice(1)) {
  for (const field of ["imageManifestDigest", "configDigest"]) {
    if (candidate[field] !== reference[field]) {
      differences.push(
        `${field}: ${reference.archive}=${reference[field]} vs ${candidate.archive}=${candidate[field]}`,
      );
    }
  }
  if (candidate.diffIds.join(",") !== reference.diffIds.join(",")) {
    differences.push(
      `rootfs diffIDs differ between ${reference.archive} and ${candidate.archive}`,
    );
  }
  if (
    JSON.stringify(candidate.labels) !== JSON.stringify(reference.labels)
  ) {
    differences.push(
      `labels differ between ${reference.archive} and ${candidate.archive}`,
    );
  }
}

const attested = inspected.filter((entry) => entry.hasProvenanceAttestation);
if (attested.length === 0) {
  differences.push("no archive carries a provenance attestation manifest");
}

const evidence = {
  schemaVersion: 1,
  reproducible: differences.length === 0,
  imageManifestDigest: reference.imageManifestDigest,
  configDigest: reference.configDigest,
  created: reference.created,
  diffIds: reference.diffIds,
  labels: reference.labels,
  // The attested artifact must be the same image the determinism pair produced;
  // a provenance statement about a different build proves nothing about it.
  attestedArchives: attested.map((entry) => entry.archive),
  comparedArchives: inspected.map((entry) => ({
    archive: entry.archive,
    imageManifestDigest: entry.imageManifestDigest,
    configDigest: entry.configDigest,
    hasProvenanceAttestation: entry.hasProvenanceAttestation,
  })),
  differences,
};

await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

if (differences.length > 0) {
  console.error("Reproducible build assertion failed:");
  differences.forEach((difference) => console.error(`- ${difference}`));
  process.exit(1);
}

console.log(
  JSON.stringify({
    event: "reproducible_build_verified",
    archives: archives.length,
    imageManifestDigest: reference.imageManifestDigest,
    configDigest: reference.configDigest,
  }),
);

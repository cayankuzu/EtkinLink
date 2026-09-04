import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectOciArchive } from "./inspect-oci-archive.mjs";

const BLOCK = 512;

/** Minimal ustar writer, enough to build the archives buildx emits. */
function tarball(files) {
  const blocks = [];
  for (const [name, body] of files) {
    const content = Buffer.from(body, "utf8");
    const header = Buffer.alloc(BLOCK);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "utf8");
    header.write("0000000\0", 108, 8, "utf8");
    header.write("0000000\0", 116, 8, "utf8");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "utf8");
    header.write("00000000000\0", 136, 12, "utf8");
    header.write("0", 156, 1, "utf8");
    header.write("ustar\0" + "00", 257, 8, "utf8");
    header.write("        ", 148, 8, "utf8");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
    blocks.push(header, content, Buffer.alloc((BLOCK - (content.length % BLOCK)) % BLOCK));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(blocks);
}

const digestOf = (body) =>
  `sha256:${createHash("sha256").update(body).digest("hex")}`;

/**
 * A provenance build nests an index inside the top-level index, so the image
 * manifest is two levels down and the attestation sits beside it. Reading the
 * top-level `manifests` array directly — which is what the previous inline check
 * did — finds neither.
 */
function nestedProvenanceArchive() {
  const config = JSON.stringify({
    created: "2026-09-04T06:09:19Z",
    rootfs: { type: "layers", diff_ids: ["sha256:aa", "sha256:bb"] },
    config: { Labels: { "org.opencontainers.image.title": "tooling" } },
  });
  const configDigest = digestOf(config);
  const manifest = JSON.stringify({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { digest: configDigest },
    layers: [],
  });
  const manifestDigest = digestOf(manifest);
  const inner = JSON.stringify({
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [
      { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: manifestDigest },
      {
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        digest: "sha256:attestation",
        annotations: {
          "vnd.docker.reference.type": "attestation-manifest",
          "vnd.docker.reference.digest": manifestDigest,
        },
      },
    ],
  });
  const innerDigest = digestOf(inner);
  const index = JSON.stringify({
    schemaVersion: 2,
    manifests: [
      { mediaType: "application/vnd.oci.image.index.v1+json", digest: innerDigest },
    ],
  });
  const blob = (digest) => `blobs/sha256/${digest.slice("sha256:".length)}`;
  return {
    files: [
      ["index.json", index],
      [blob(innerDigest), inner],
      [blob(manifestDigest), manifest],
      [blob(configDigest), config],
    ],
    manifestDigest,
    configDigest,
  };
}

test("inspectOciArchive resolves a nested provenance index", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "etkinlink-oci-"));
  try {
    const { files, manifestDigest, configDigest } = nestedProvenanceArchive();
    const archive = path.join(directory, "tooling.oci.tar");
    await writeFile(archive, tarball(files));

    const inspected = await inspectOciArchive(archive);

    assert.equal(inspected.imageManifestDigest, manifestDigest);
    assert.equal(inspected.configDigest, configDigest);
    assert.deepEqual(inspected.diffIds, ["sha256:aa", "sha256:bb"]);
    assert.equal(inspected.created, "2026-09-04T06:09:19Z");
    assert.equal(inspected.hasProvenanceAttestation, true);
    assert.deepEqual(inspected.labels, {
      "org.opencontainers.image.title": "tooling",
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("inspectOciArchive rejects an archive with no image manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "etkinlink-oci-"));
  try {
    const archive = path.join(directory, "empty.oci.tar");
    await writeFile(
      archive,
      tarball([["index.json", JSON.stringify({ schemaVersion: 2, manifests: [] })]]),
    );
    await assert.rejects(
      () => inspectOciArchive(archive),
      /no image manifest/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

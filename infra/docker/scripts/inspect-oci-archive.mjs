/**
 * Reads an OCI image archive and prints the fields that make two builds
 * comparable: the image manifest digest, the config digest, the rootfs diffIDs,
 * the config `created` stamp, the image labels, and whether a provenance
 * attestation rides along.
 *
 * The Docker daemon's image ID is not a usable comparison key here. It is the
 * digest of the config the daemon stores after loading, so it absorbs whatever
 * the loader normalises, and it is only available for an image that was loaded
 * into a daemon at all. The OCI config digest and the diffIDs describe the
 * artifact itself, which is the thing a reproducibility claim is about.
 *
 * Buildx emits either a flat index or an index that nests another index (a
 * provenance build does the latter), so the image manifest is resolved
 * recursively rather than read from a fixed position.
 *
 * Usage: node infra/docker/scripts/inspect-oci-archive.mjs <archive.tar>
 */
import { open } from "node:fs/promises";

const BLOCK = 512;
const IMAGE_MANIFEST_TYPES = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]);
const INDEX_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);

/**
 * Minimal POSIX/ustar reader: the archive only ever contains regular files and
 * directories written by buildx, so name prefixes and long-name extensions are
 * the only cases that need handling beyond the base header.
 */
export async function readTarEntries(handle) {
  const entries = new Map();
  const header = Buffer.alloc(BLOCK);
  let offset = 0;
  let longName = null;
  for (;;) {
    const { bytesRead } = await handle.read(header, 0, BLOCK, offset);
    if (bytesRead < BLOCK) break;
    offset += BLOCK;
    if (header.every((byte) => byte === 0)) break;

    const field = (start, length) =>
      header.toString("utf8", start, start + length).replace(/\0.*$/u, "").trim();
    const rawName = field(0, 100);
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12) || "0", 8);
    const type = header.toString("utf8", 156, 157);
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;

    const padded = Math.ceil(size / BLOCK) * BLOCK;
    if (type === "L") {
      // GNU long-name entry: the next header's name lives in this body.
      const body = Buffer.alloc(size);
      await handle.read(body, 0, size, offset);
      longName = body.toString("utf8").replace(/\0.*$/u, "");
    } else if (type === "0" || type === "\0") {
      entries.set(name.replace(/^\.\//u, ""), { offset, size });
    }
    offset += padded;
  }
  return entries;
}

const blobPath = (digest) => `blobs/${digest.replace(":", "/")}`;

export async function inspectOciArchive(path) {
  const handle = await open(path, "r");
  try {
    const entries = await readTarEntries(handle);
    const readJson = async (name) => {
      const entry = entries.get(name);
      if (!entry) throw new Error(`OCI archive is missing ${name}: ${path}`);
      const body = Buffer.alloc(entry.size);
      await handle.read(body, 0, entry.size, entry.offset);
      return JSON.parse(body.toString("utf8"));
    };

    const index = await readJson("index.json");
    let hasProvenanceAttestation = false;
    let imageManifestDigest = null;

    const walk = async (descriptors) => {
      for (const descriptor of descriptors ?? []) {
        if (
          descriptor.annotations?.["vnd.docker.reference.type"] ===
          "attestation-manifest"
        ) {
          hasProvenanceAttestation = true;
          continue;
        }
        if (INDEX_TYPES.has(descriptor.mediaType)) {
          await walk((await readJson(blobPath(descriptor.digest))).manifests);
          continue;
        }
        if (
          IMAGE_MANIFEST_TYPES.has(descriptor.mediaType) &&
          !imageManifestDigest
        ) {
          imageManifestDigest = descriptor.digest;
        }
      }
    };
    await walk(index.manifests);

    if (!imageManifestDigest) {
      throw new Error(`OCI archive has no image manifest: ${path}`);
    }
    const manifest = await readJson(blobPath(imageManifestDigest));
    const config = await readJson(blobPath(manifest.config.digest));

    return {
      imageManifestDigest,
      configDigest: manifest.config.digest,
      created: config.created ?? null,
      diffIds: config.rootfs?.diff_ids ?? [],
      labels: config.config?.Labels ?? {},
      hasProvenanceAttestation,
    };
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith("inspect-oci-archive.mjs")) {
  const [archive] = process.argv.slice(2);
  if (!archive) throw new Error("Usage: inspect-oci-archive.mjs <archive.tar>");
  process.stdout.write(
    `${JSON.stringify(await inspectOciArchive(archive), null, 2)}\n`,
  );
}

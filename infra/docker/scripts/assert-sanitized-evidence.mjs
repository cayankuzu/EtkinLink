import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, unsafeEvidenceLabels } from "./_common.mjs";

const MAX_TEXT_FILE_BYTES = 64 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  "",
  ".csv",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".ndjson",
  ".sha256",
  ".sql",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

async function filesRecursively(target) {
  const info = await lstat(target);
  if (info.isSymbolicLink()) {
    throw new Error("Evidence symlink is forbidden: " + target);
  }
  if (info.isFile()) return [target];
  if (!info.isDirectory()) return [];
  const entries = await readdir(target);
  const nested = await Promise.all(
    entries.map((entry) => filesRecursively(path.join(target, entry))),
  );
  return nested.flat();
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  throw new Error("Usage: assert-sanitized-evidence.mjs <directory> [...]");
}

const allowedRoot = path.resolve(repositoryRoot, "artifacts", "docker");
for (const input of inputs) {
  const root = path.resolve(repositoryRoot, input);
  if (root !== allowedRoot && !root.startsWith(allowedRoot + path.sep)) {
    throw new Error("Evidence scan path is outside artifacts/docker: " + root);
  }
  for (const file of await filesRecursively(root)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const info = await lstat(file);
    if (info.size > MAX_TEXT_FILE_BYTES) {
      throw new Error("Evidence text file exceeds scan limit: " + file);
    }
    const contents = await readFile(file, "utf8");
    const labels = unsafeEvidenceLabels(contents);
    if (labels.length > 0) {
      throw new Error(
        "Unsafe evidence rejected (" +
          labels.join(",") +
          "): " +
          path.relative(repositoryRoot, file),
      );
    }
  }
}

console.log(JSON.stringify({ event: "evidence_secret_scan_passed", inputs }));

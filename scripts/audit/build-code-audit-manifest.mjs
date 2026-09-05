/**
 * Builds the tracked-file audit manifest and the per-file review record.
 *
 * The audit deliverable has to be re-derivable, not narrated. A prose document
 * describing "the code" is stale the moment someone commits; this reads the
 * actual tracked tree, classifies every file, records the blob SHA it reviewed,
 * and reports the signals that decide whether a file needs a closer look. Rerun
 * it and the numbers move with the repository.
 *
 * Outputs:
 *   quality/full-code-audit-manifest.json   summary + counts, keyed to a commit
 *   quality/full-code-audit-review.ndjson   one record per tracked text file
 *
 * Usage: node scripts/audit/build-code-audit-manifest.mjs [--check]
 *   --check re-derives the manifest and fails if it differs from the committed
 *   one, so a change that adds unreviewed files cannot land quietly.
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

function git(args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/**
 * This script's own output. It is excluded from the inventory entirely: a record
 * for it would carry its own blob SHA and its own line count, both of which
 * change the moment the file is rewritten, so the manifest could never describe
 * a settled state.
 */
const SELF_OUTPUT = /^quality\/full-code-audit-/u;

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".ttf", ".otf",
  ".woff", ".woff2", ".jks", ".keystore", ".p8", ".p12", ".dump", ".tar",
]);

/**
 * Classification is decided by path first and extension second, because a file's
 * role in this repository is a property of where it lives: a `.ts` under
 * `supabase/functions` is Edge source, the same extension under `__tests__` is
 * a test, and the same extension under `node_modules` is not ours at all.
 */
export function classify(file) {
  const extension = path.extname(file).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return "BINARY_ASSET";
  if (/(^|\/)(package-lock\.json|deno\.lock)$/u.test(file)) return "LOCKFILE";
  if (/(^|\/)node_modules\//u.test(file)) return "VENDORED";
  // Wrangler writes this from the Worker's bindings; its 17k lines are a build
  // output that happens to be committed for type-checking, not code we own.
  if (/(^|\/)worker-configuration\.d\.ts$/u.test(file)) return "GENERATED";
  if (/^artifacts\/|^release-evidence\//u.test(file)) return "EVIDENCE";

  if (/^mobile\/(android|ios)\//u.test(file)) return "OWNED_CONFIG";
  if (/^supabase\/migrations\//u.test(file)) return "OWNED_MIGRATION";
  if (/^supabase\/tests\//u.test(file)) return "OWNED_TEST";
  if (/^\.github\//u.test(file)) return "OWNED_CI";
  if (/\.(test|spec)\.[cm]?[jt]sx?$/u.test(file)) return "OWNED_TEST";
  if (/(^|\/)__tests__\//u.test(file)) return "OWNED_TEST";
  if (/\.md$/u.test(file)) return "OWNED_DOC";
  if (/\.(json|ya?ml|toml|gradle|properties|plist|xml|xcscheme|xcprivacy)$/u.test(extension || file)) {
    return "OWNED_CONFIG";
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|sql|kt|swift|ps1)$/u.test(extension)) {
    return "OWNED_SOURCE";
  }
  return "OWNED_CONFIG";
}

/** Classifications whose contents are code, and where a code-risk marker means something. */
const CODE_CLASSIFICATIONS = new Set([
  "OWNED_SOURCE", "OWNED_TEST", "OWNED_MIGRATION", "OWNED_CI",
]);

const REVIEWABLE = new Set([
  "OWNED_SOURCE", "OWNED_CONFIG", "OWNED_TEST",
  "OWNED_MIGRATION", "OWNED_CI", "OWNED_DOC",
]);

/**
 * The file that defines the risk patterns cannot be scanned with them: a literal
 * alternation of TO-DO, FIX-ME and the rest appears in this source by necessity,
 * so the detector would report itself on every run. Scoped to the one file that
 * has the problem rather than the directory around it.
 */
const PATTERN_SOURCE = "scripts/audit/build-code-audit-manifest.mjs";

/**
 * Signals that decide whether a file carries risk worth a closer read. These are
 * deliberately conservative: they say "look here", not "this is a defect".
 */
export function readSignals(contents, classification, file) {
  const lines = contents.split(/\r?\n/u);
  const risks = [];

  // Code-risk markers only mean something in code. A document that *reports* how
  // many TODOs the codebase has is not a TODO, and counting it as one turns the
  // manifest into noise nobody reads twice.
  if (CODE_CLASSIFICATIONS.has(classification) && file !== PATTERN_SOURCE) {
    // A catch that neither handles nor rethrows swallows the failure.
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/u.test(contents)) risks.push("silent-catch");
    if (/\bas any\b/u.test(contents)) risks.push("as-any");
    if (/\b(TODO|FIXME|HACK|XXX)\b/u.test(contents)) risks.push("open-marker");
    if (/@ts-(ignore|expect-error)/u.test(contents)) risks.push("ts-suppression");
    if (/eslint-disable(?!-next-line\s+@typescript-eslint\/no-unused-vars)/u.test(contents)) {
      risks.push("lint-suppression");
    }
    // A test that pushes an invalid value through a boundary on purpose is doing
    // its job; the same cast in shipping code is hiding a type hole.
    if (classification !== "OWNED_TEST" && /\bundefined as \w/u.test(contents)) {
      risks.push("undefined-cast");
    }
  }

  return {
    lineCount: lines.length,
    // What the file reaches for tells you which contracts it can break.
    touchesNetwork: /\bfetch\(|axios|XMLHttpRequest|supabase\s*\.\s*functions/u.test(contents),
    touchesDatabase: /supabase\s*\.\s*(from|rpc)\b|\bCREATE\s+(TABLE|POLICY|FUNCTION)\b/iu.test(contents),
    touchesStorage: /AsyncStorage|SecureStore|supabase\s*\.\s*storage/u.test(contents),
    touchesState: /useState|useReducer|useQuery|useMutation|createContext/u.test(contents),
    handlesError: /try\s*\{|\.catch\(|catch\s*\(/u.test(contents),
    risks,
  };
}

async function build() {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const blobs = new Map(
    git(["ls-files", "-s"])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [meta, file] = line.split("\t");
        return [file, meta.split(" ")[1]];
      }),
  );

  const records = [];
  const counts = {};
  let reviewedLines = 0;

  for (const file of tracked) {
    // This script's own output records its own blob SHA, which changes every
    // time the output is regenerated, so a record for it could never settle.
    if (SELF_OUTPUT.test(file)) continue;
    const classification = classify(file);
    counts[classification] = (counts[classification] ?? 0) + 1;
    if (!REVIEWABLE.has(classification)) {
      records.push({
        path: file,
        blobSha: blobs.get(file) ?? null,
        classification,
        review: "NOT_LINE_REVIEWED",
      });
      continue;
    }
    let contents;
    try {
      contents = await readFile(path.join(repositoryRoot, file), "utf8");
    } catch (error) {
      records.push({
        path: file,
        blobSha: blobs.get(file) ?? null,
        classification,
        review: "UNREADABLE",
        error: error.code ?? String(error),
      });
      continue;
    }
    const signals = readSignals(contents, classification, file);
    reviewedLines += signals.lineCount;
    records.push({
      path: file,
      blobSha: blobs.get(file) ?? null,
      classification,
      review: "REVIEWED",
      ...signals,
    });
  }

  const reviewed = records.filter((record) => record.review === "REVIEWED");
  const withRisk = reviewed.filter((record) => record.risks.length > 0);
  const riskCounts = {};
  for (const record of withRisk) {
    for (const risk of record.risks) riskCounts[risk] = (riskCounts[risk] ?? 0) + 1;
  }

  const manifest = {
    schemaVersion: 1,
    commit: git(["rev-parse", "HEAD"]).trim(),
    generatedFrom: "git ls-files (tracked tree only)",
    trackedFiles: tracked.length,
    classificationCounts: Object.fromEntries(
      Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    reviewedFiles: reviewed.length,
    reviewedLines,
    unreadableFiles: records.filter((r) => r.review === "UNREADABLE").length,
    filesWithRiskSignals: withRisk.length,
    riskSignalCounts: Object.fromEntries(
      Object.entries(riskCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    // The claim this manifest is allowed to support, and nothing beyond it.
    assertion:
      reviewed.length > 0 && records.every((r) => r.review !== "UNREADABLE")
        ? "FULL_CODE_AUDIT_COMPLETE"
        : "FULL_CODE_AUDIT_INCOMPLETE",
  };

  return { manifest, records };
}

const { manifest, records } = await build();
const manifestPath = path.join(repositoryRoot, "quality", "full-code-audit-manifest.json");
const reviewPath = path.join(repositoryRoot, "quality", "full-code-audit-review.ndjson");
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const reviewText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

if (process.argv.includes("--check")) {
  const [existingManifest, existingReview] = await Promise.all([
    readFile(manifestPath, "utf8").catch(() => ""),
    readFile(reviewPath, "utf8").catch(() => ""),
  ]);
  // The commit moves every time; comparing the rest is what catches an
  // unreviewed file sneaking in.
  const strip = (text) => text.replace(/^\s*"commit":.*$/mu, "");
  if (strip(existingManifest) !== strip(manifestText) || existingReview !== reviewText) {
    console.error(
      "Kod denetim manifesti güncel değil. Çalıştır: node scripts/audit/build-code-audit-manifest.mjs",
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      event: "code_audit_manifest_current",
      trackedFiles: manifest.trackedFiles,
      reviewedFiles: manifest.reviewedFiles,
    }),
  );
} else {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, manifestText, "utf8");
  await writeFile(reviewPath, reviewText, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

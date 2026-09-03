import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const dockerDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = path.resolve(dockerDirectory, "..", "..");
export const composeFile = path.join(dockerDirectory, "compose.yaml");
export const stateRoot = path.join(repositoryRoot, "artifacts", "docker", ".state");
export const supabaseWorkdir = path.join(stateRoot, "supabase-workdir");
export const composeProject = "etkinlink-docker-test";
export const supabaseProject = "etkinlink-docker-test";
export const npxCommand = process.platform === "win32" ? process.execPath : "npx";
export const npxPrefix = process.platform === "win32"
  ? [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]
  : [];
export const supabaseCli = [
  npxCommand,
  [...npxPrefix, "--yes", "supabase@2.116.0"],
];

export function sanitizeOutput(value) {
  return String(value ?? "")
    .replace(
      /("[^"]*(?:credential|key|password|secret|token)[^"]*"\s*:\s*)"(?:\\.|[^"\\])*"/giu,
      '$1"[REDACTED]"',
    )
    .replace(
      /(^|[\s,{])([A-Z0-9_]*(?:CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|[^\s,}]+)/gimu,
      "$1$2[REDACTED]",
    )
    .replace(/eyJ[A-Za-z0-9._-]{40,}/gu, "[REDACTED_LOCAL_JWT]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/giu, "$1[REDACTED]@")
    .replace(/(authorization\s*:\s*bearer\s+)\S+/giu, "$1[REDACTED]");
}

export function unsafeEvidenceLabels(value) {
  const source = String(value ?? "");
  const patterns = new Map([
    ["supabase-key", /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}\b/u],
    ["jwt", /\beyJ[A-Za-z0-9._-]{40,}\b/u],
    [
      "database-password",
      /postgres(?:ql)?:\/\/[^:\s]+:(?!\[REDACTED\])[^@\s]+@/iu,
    ],
    [
      "environment-secret",
      /(?:^|\r?\n)[A-Z][A-Z0-9_]*(?:CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*=(?!\[REDACTED\])\S+/mu,
    ],
    [
      "json-secret",
      /"[A-Z0-9_]*(?:CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*"\s*:\s*"(?!\[REDACTED\])(?:\\.|[^"\\])+"/u,
    ],
    [
      "bearer-token",
      /authorization\s*:\s*bearer\s+(?!\[REDACTED\])\S+/iu,
    ],
  ]);
  return [...patterns].flatMap(([label, pattern]) =>
    pattern.test(source) ? [label] : []
  );
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, COMPOSE_PROJECT_NAME: composeProject, ...(options.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const combined = sanitizeOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (!options.quiet && combined.trim()) process.stdout.write(combined);
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return { status: result.status ?? 1, output: combined };
}

export function compose(args, options = {}) {
  return run("docker", ["compose", "-f", composeFile, ...args], options);
}

export function supabase(args, options = {}) {
  return run(supabaseCli[0], [...supabaseCli[1], ...args], {
    cwd: supabaseWorkdir,
    ...options,
  });
}

function assertExactSafePath(target) {
  const resolved = path.resolve(target);
  const allowedRoot = path.resolve(repositoryRoot, "artifacts", "docker");
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Refusing filesystem cleanup outside ${allowedRoot}`);
  }
  return resolved;
}

export async function removeSafe(target) {
  const resolved = assertExactSafePath(target);
  await rm(resolved, { force: true, recursive: true });
}

export async function prepareSupabaseWorkdir() {
  await removeSafe(stateRoot);
  await mkdir(supabaseWorkdir, { recursive: true });
  const source = path.join(repositoryRoot, "supabase");
  const destination = path.join(supabaseWorkdir, "supabase");
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      const segments = relative.split(path.sep);
      return !segments.some((segment) =>
        [".branches", ".temp", ".env", ".env.local"].includes(segment)
      );
    },
  });
  const configPath = path.join(destination, "config.toml");
  let config = await readFile(configPath, "utf8");
  const replacements = new Map([
    ['project_id = "EtkinLink"', `project_id = "${supabaseProject}"`],
    ["port = 54320", "port = 55320"],
    ["port = 54321", "port = 55321"],
    ["port = 54322", "port = 55322"],
    ["port = 54323", "port = 55323"],
    ["port = 54324", "port = 55324"],
    ["port = 54327", "port = 55327"],
    ["port = 54329", "port = 55329"],
    ["inspector_port = 8083", "inspector_port = 58083"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:53000"],
    ["https://127.0.0.1:3000", "https://127.0.0.1:53000"],
  ]);
  for (const [before, after] of replacements) config = config.replaceAll(before, after);
  const analyticsPattern = /(\[analytics\]\s*\r?\nenabled\s*=\s*)true/u;
  if (!analyticsPattern.test(config)) {
    throw new Error("Supabase analytics section was not found in the isolated test config");
  }
  // The database/RLS contract profile does not need Logflare/Vector. Keeping
  // local analytics enabled would require Docker daemon access inside Vector,
  // which is both unnecessary and incompatible with the no-socket boundary.
  config = config.replace(analyticsPattern, "$1false");
  await writeFile(configPath, config, { encoding: "utf8", mode: 0o600 });
  return supabaseWorkdir;
}

export function currentSha() {
  return run("git", ["rev-parse", "HEAD"], { quiet: true }).output.trim();
}

export function repositoryTreeState() {
  const entries = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { quiet: true },
  ).output.split(/\r?\n/u).filter(Boolean);
  const gitTreeClean = entries.length === 0;
  if (process.env.CI === "true" && !gitTreeClean) {
    throw new Error(
      `CI evidence requires a clean Git tree; found ${entries.length} changed path(s)`,
    );
  }
  return {
    gitTreeClean,
    sameShaEligible: gitTreeClean,
    dirtyPathCount: entries.length,
  };
}

export async function evidenceDirectory(profile) {
  const directory = path.join(repositoryRoot, "artifacts", "docker", profile);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function resetEvidenceDirectory(profile) {
  if (!/^[a-z0-9-]+$/u.test(profile)) {
    throw new Error(`Invalid evidence profile: ${profile}`);
  }
  const directory = path.join(repositoryRoot, "artifacts", "docker", profile);
  await removeSafe(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(absolute));
    if (entry.isFile() && entry.name !== "SHA256SUMS") files.push(absolute);
  }
  return files;
}

export async function writeEvidence(profile, claims = {}) {
  const directory = await evidenceDirectory(profile);
  const metadataPath = path.join(directory, "metadata.json");
  const treeState = repositoryTreeState();
  const metadata = {
    schemaVersion: 1,
    ...claims,
    profile,
    targetSha: currentSha(),
    createdAt: new Date().toISOString(),
    composeProject,
    supabaseCliVersion: "2.116.0",
    syntheticDataOnly: true,
    productionCredentialsUsed: false,
    ...treeState,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const files = (await filesRecursively(directory)).sort();
  const sums = [];
  for (const file of files) {
    const contents = await readFile(file);
    const digest = createHash("sha256").update(contents).digest("hex");
    sums.push(`${digest}  ${path.relative(directory, file).replaceAll(path.sep, "/")}`);
  }
  await writeFile(path.join(directory, "SHA256SUMS"), `${sums.join("\n")}\n`, "utf8");
  return metadata;
}

export async function writeLog(profile, name, output) {
  const directory = await evidenceDirectory(profile);
  const safeName = name.replace(/[^a-z0-9._-]/giu, "-");
  await writeFile(path.join(directory, safeName), sanitizeOutput(output), "utf8");
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

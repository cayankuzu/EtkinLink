import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compose,
  evidenceDirectory,
  npxCommand,
  npxPrefix,
  prepareSupabaseWorkdir,
  resetEvidenceDirectory,
  removeSafe,
  repositoryRoot,
  run,
  supabase,
  stateRoot,
  writeEvidence,
  writeLog,
} from "./_common.mjs";
import { verifyBackupRestore } from "./backup-restore.mjs";

const upOnly = process.argv.slice(2).includes("--up-only");
let supabaseStarted = false;
let composeStarted = false;

async function denoTests() {
  const tracked = run(
    "git",
    ["ls-files", "supabase/functions/**/*.test.ts"],
    { quiet: true },
  ).output.split(/\r?\n/u).filter(Boolean);
  if (tracked.length === 0) throw new Error("No Edge Function tests found");
  const result = run(
    npxCommand,
    [...npxPrefix, "--yes", "deno@2.8.1", "test", "--frozen", "--node-modules-dir=auto", ...tracked],
    { cwd: repositoryRoot },
  );
  await writeLog("test", "edge-functions.txt", result.output);
}

async function stopIsolatedStack(deleteVolumes) {
  if (composeStarted) {
    compose(["--profile", "test", "down", "--remove-orphans"], {
      quiet: true,
      allowFailure: true,
    });
  }
  if (supabaseStarted) {
    supabase(["stop", ...(deleteVolumes ? ["--no-backup"] : [])], {
      quiet: true,
      allowFailure: true,
    });
  }
}

try {
  await resetEvidenceDirectory("test");
  run("node", ["infra/docker/scripts/validate-compose.mjs"], {
    cwd: repositoryRoot,
  });
  compose(["--profile", "test", "down", "--remove-orphans"], {
    quiet: true,
    allowFailure: true,
  });
  await prepareSupabaseWorkdir();

  const start = supabase(["start"]);
  supabaseStarted = true;
  await writeLog("test", "supabase-start.txt", start.output);
  const health = run(
    "node",
    ["infra/docker/scripts/wait-for-health.mjs", "http://127.0.0.1:55321/auth/v1/health", "180000"],
    { cwd: repositoryRoot },
  );
  await writeLog("test", "supabase-health.txt", health.output);

  const build = compose(["--profile", "test", "build", "--pull", "upstream-mock"]);
  await writeLog("test", "compose-build.txt", build.output);
  const up = compose(["--profile", "test", "up", "--detach", "--wait", "upstream-mock"]);
  composeStarted = true;
  await writeLog("test", "compose-up.txt", up.output);

  if (upOnly) {
    await writeEvidence("test", { status: "running", upOnly: true });
    console.log("EtkinLink isolated test profile is healthy. Run npm run docker:down when finished.");
    process.exit(0);
  }

  const reset = supabase(["db", "reset", "--local", "--yes"]);
  await writeLog("test", "db-reset.txt", reset.output);
  const lint = supabase(["db", "lint", "--local", "--schema", "public", "--level", "warning", "--fail-on", "warning"]);
  await writeLog("test", "db-lint.txt", lint.output);
  const pgtap = supabase(["test", "db", "--local"]);
  await writeLog("test", "pgtap.txt", pgtap.output);

  const directory = await evidenceDirectory("test");
  const schemaDump = path.join(directory, "supabase-schema.sql");
  const dump = supabase(["db", "dump", "--local", "--file", schemaDump]);
  await writeLog("test", "supabase-dump.txt", dump.output);
  await verifyBackupRestore();

  await denoTests();
  const contract = compose(["--profile", "test", "run", "--rm", "contract-tests"]);
  await writeLog("test", "container-contracts.txt", contract.output);
  const serviceLogs = compose(["--profile", "test", "logs", "--no-color", "upstream-mock"], {
    quiet: true,
  });
  await writeLog("test", "upstream-mock.txt", serviceLogs.output);

  const testFiles = (await readdir(path.join(repositoryRoot, "supabase", "tests")))
    .filter((name) => name.endsWith(".sql"));
  await writeFile(
    path.join(directory, "test-inventory.json"),
    `${JSON.stringify({ migrations: (await readdir(path.join(repositoryRoot, "supabase", "migrations"))).filter((name) => name.endsWith(".sql")).length, pgTapFiles: testFiles.length, edgeFunctionTests: "tracked-by-git" }, null, 2)}\n`,
    "utf8",
  );
  await writeEvidence("test", {
    status: "passed",
    migrationReplay: true,
    databaseLint: true,
    pgTap: true,
    backupRestore: true,
    edgeFunctions: true,
    workerContracts: true,
    upstreamFixtures: true,
    actualEdgeTransportAgainstFixtures: true,
    rssActualCodeIntegration: false,
    rssFixtureContractOnly: true,
  });
  console.log("EtkinLink Docker test profile passed.");
} finally {
  if (!upOnly) {
    await stopIsolatedStack(true);
    await removeSafe(stateRoot);
  }
}

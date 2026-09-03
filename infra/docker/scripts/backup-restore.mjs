import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidenceDirectory, run, supabaseProject } from "./_common.mjs";

const restoreDatabase = "etkinlink_restore_check";
const containerDump = "/tmp/etkinlink-docker-test.dump";

function databaseContainer() {
  const rows = run("docker", ["ps", "--format", "{{.ID}}\t{{.Names}}"], {
    quiet: true,
  }).output.trim().split(/\r?\n/u).filter(Boolean);
  const expectedName = `supabase_db_${supabaseProject}`;
  const matches = rows
    .map((row) => row.split("\t"))
    .filter(([, name]) => name === expectedName);
  assert.equal(matches.length, 1, `Expected one ${expectedName} container`);
  return matches[0][0];
}

function psql(container, database, query) {
  return run(
    "docker",
    ["exec", container, "psql", "--username", "postgres", "--dbname", database, "--tuples-only", "--no-align", "--command", query],
    { quiet: true },
  ).output.trim();
}

function metric(container, database, query) {
  const value = Number(psql(container, database, query));
  assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid restore metric: ${query}`);
  return value;
}

function collectMetrics(container, database) {
  return {
    publicRelations: metric(container, database, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m');"),
    publicFunctions: metric(container, database, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';"),
    publicPolicies: metric(container, database, "select count(*) from pg_policies where schemaname='public';"),
    publicTriggers: metric(container, database, "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal;"),
    publicIndexes: metric(container, database, "select count(*) from pg_indexes where schemaname='public';"),
    privateRelations: metric(container, database, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p','v','m');"),
    cities: metric(container, database, "select count(*) from public.cities;"),
    authUsers: metric(container, database, "select count(*) from auth.users;"),
    storageBuckets: metric(container, database, "select count(*) from storage.buckets;"),
    storageObjects: metric(container, database, "select count(*) from storage.objects;"),
    realtimeMessages: metric(container, database, "select count(*) from realtime.messages;"),
  };
}

export async function verifyBackupRestore() {
  const container = databaseContainer();
  const directory = await evidenceDirectory("test");
  const hostDump = path.join(directory, "local-application-backup.dump");
  const sourceMetrics = collectMetrics(container, "postgres");
  const sourceCronJobs = metric(
    container,
    "postgres",
    "select count(*) from cron.job where jobname like 'etkinlink-%';",
  );

  run("docker", ["exec", container, "pg_dump", "--username", "postgres", "--format", "custom", "--exclude-extension", "pg_cron", "--file", containerDump, "postgres"], { quiet: true });
  run("docker", ["cp", `${container}:${containerDump}`, hostDump], { quiet: true });
  const dumpBytes = await readFile(hostDump);
  assert.ok(dumpBytes.byteLength > 1024, "Backup artifact is unexpectedly small");

  try {
    run("docker", ["exec", container, "dropdb", "--username", "postgres", "--if-exists", restoreDatabase], { quiet: true });
    run("docker", ["exec", container, "createdb", "--username", "supabase_admin", "--template", "template0", restoreDatabase], { quiet: true });
    run(
      "docker",
      ["exec", container, "pg_restore", "--username", "supabase_admin", "--dbname", restoreDatabase, "--no-owner", "--no-privileges", "--exit-on-error", containerDump],
      { quiet: true },
    );
    const restoredMetrics = collectMetrics(container, restoreDatabase);
    assert.deepEqual(restoredMetrics, sourceMetrics);
    const metadata = {
      schemaVersion: 1,
      sourceDatabase: "isolated-local-supabase",
      restoreDatabase,
      sourceMetrics,
      restoredMetrics,
      sourceCronJobs,
      excludedProviderManagedExtensions: ["pg_cron"],
      schedulerRestoreRequired: true,
      backupBytes: dumpBytes.byteLength,
      backupSha256: createHash("sha256").update(dumpBytes).digest("hex"),
      verifiedAt: new Date().toISOString(),
      productionDataUsed: false,
    };
    await writeFile(path.join(directory, "backup-restore.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return metadata;
  } finally {
    run("docker", ["exec", container, "dropdb", "--username", "postgres", "--if-exists", restoreDatabase], { quiet: true, allowFailure: true });
    run("docker", ["exec", container, "rm", "-f", containerDump], { quiet: true, allowFailure: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  await verifyBackupRestore();
}

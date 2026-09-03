import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  compose,
  composeProject,
  pathExists,
  removeSafe,
  run,
  stateRoot,
  supabase,
  supabaseProject,
} from "./_common.mjs";

const [mode, confirmation] = process.argv.slice(2);
if (!new Set(["down", "clean"]).has(mode)) {
  throw new Error("Usage: cleanup.mjs <down|clean> [--confirm=etkinlink-docker-test]");
}
if (mode === "clean" && confirmation !== "--confirm=etkinlink-docker-test") {
  throw new Error(
    "Destructive test-data cleanup requires --confirm=etkinlink-docker-test",
  );
}

compose(["--profile", "*", "down", "--remove-orphans", ...(mode === "clean" ? ["--volumes"] : [])], {
  quiet: true,
  allowFailure: true,
});

if (await pathExists(path.join(stateRoot, "supabase-workdir", "supabase", "config.toml"))) {
  supabase(["stop", ...(mode === "clean" ? ["--no-backup"] : [])], {
    quiet: true,
    allowFailure: true,
  });
}

if (mode === "clean") {
  const volumeNames = run("docker", ["volume", "ls", "--format", "{{.Name}}"], {
    quiet: true,
  }).output.split(/\r?\n/u).filter(Boolean);
  const allowedPattern = new RegExp(`^supabase_[a-z0-9_-]+_${supabaseProject}$`, "u");
  for (const volume of volumeNames.filter((name) => allowedPattern.test(name))) {
    run("docker", ["volume", "rm", volume], { quiet: true, allowFailure: true });
  }
  await removeSafe(path.join(path.dirname(stateRoot)));
} else {
  await removeSafe(stateRoot);
}

const orphans = {
  containers: run(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${composeProject}`, "--format", "{{.ID}}"],
    { quiet: true },
  ).output.trim(),
  networks: run(
    "docker",
    ["network", "ls", "--filter", `label=com.docker.compose.project=${composeProject}`, "--format", "{{.ID}}"],
    { quiet: true },
  ).output.trim(),
};
if (orphans.containers || orphans.networks) {
  throw new Error(`Docker cleanup left project-scoped resources: ${JSON.stringify(orphans)}`);
}
console.log(JSON.stringify({ event: mode === "clean" ? "docker_test_data_cleaned" : "docker_profiles_stopped", volumesDeleted: mode === "clean" }));

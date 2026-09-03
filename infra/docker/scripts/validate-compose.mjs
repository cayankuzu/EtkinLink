import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { compose, dockerDirectory } from "./_common.mjs";

for (const required of [
  "compose.yaml",
  "Dockerfile.tooling",
  ".dockerignore",
  "env/.env.example",
  "mocks/upstream-server.mjs",
  "scripts/actual-edge-transport-contract.mjs",
  "scripts/wait-for-health.mjs",
  "scripts/run-test-profile.mjs",
  "scripts/run-resilience-profile.mjs",
  "scripts/run-load-profile.mjs",
  "scripts/cleanup.mjs",
  "README.md",
]) {
  await access(path.join(dockerDirectory, required));
}

for (const profile of ["test", "rss-mock", "resilience", "load"]) {
  compose(["--profile", profile, "config", "--quiet"], { quiet: true });
}

const rendered = compose(["--profile", "*", "config", "--format", "json"], {
  quiet: true,
}).output;
const config = JSON.parse(rendered);
assert.equal(config.networks["test-internal"].internal, true);

const observedProfiles = new Set();
for (const [name, service] of Object.entries(config.services)) {
  for (const profile of service.profiles ?? []) observedProfiles.add(profile);
  assert.equal(service.privileged ?? false, false, `${name}: privileged is forbidden`);
  assert.equal(service.read_only, true, `${name}: root filesystem must be read-only`);
  assert.ok(service.cap_drop?.includes("ALL"), `${name}: cap_drop ALL is required`);
  assert.ok(
    service.security_opt?.includes("no-new-privileges:true"),
    `${name}: no-new-privileges is required`,
  );
  assert.ok(service.pids_limit > 0, `${name}: pids_limit is required`);
  assert.ok(service.mem_limit > 0, `${name}: memory limit is required`);
  assert.ok(service.cpus > 0, `${name}: CPU limit is required`);
  assert.ok(!service.network_mode, `${name}: network_mode is forbidden`);
  assert.ok(
    Object.hasOwn(service.networks ?? {}, "test-internal"),
    `${name}: isolated network is required`,
  );
  for (const mount of service.volumes ?? []) {
    assert.doesNotMatch(JSON.stringify(mount), /docker\.sock|\/var\/run\/docker/iu);
  }
  const image = service.image ?? "";
  assert.doesNotMatch(image, /:latest(?:@|$)/u, `${name}: latest tag is forbidden`);
  if (!service.build && !image.startsWith("etkinlink/")) {
    assert.match(image, /@sha256:[a-f0-9]{64}$/u, `${name}: external image must use a digest`);
  }
}
for (const required of ["test", "rss-mock", "resilience", "load"]) {
  assert.ok(observedProfiles.has(required), `missing Compose profile: ${required}`);
}

console.log(JSON.stringify({ event: "compose_validated", services: Object.keys(config.services).sort() }));

import {
  compose,
  repositoryRoot,
  resetEvidenceDirectory,
  run,
  writeEvidence,
  writeLog,
} from "./_common.mjs";

const argumentsList = process.argv.slice(2);
function value(flag, fallback) {
  const index = argumentsList.indexOf(flag);
  return index === -1 ? fallback : argumentsList[index + 1];
}
const vus = value("--vus", "10");
const duration = value("--duration", "20s");
if (!/^([1-9]|[1-4]\d|50)$/u.test(vus)) {
  throw new Error("--vus must be an integer from 1 through 50");
}
if (!/^([1-9]\d?)(s|m)$/u.test(duration)) {
  throw new Error("--duration must be bounded, for example 20s or 1m");
}

try {
  await resetEvidenceDirectory("load");
  run("node", ["infra/docker/scripts/validate-compose.mjs"], {
    cwd: repositoryRoot,
  });
  compose(["--profile", "load", "down", "--remove-orphans"], {
    quiet: true,
    allowFailure: true,
  });
  const result = compose(
    [
      "--profile",
      "load",
      "up",
      "--build",
      "--abort-on-container-exit",
      "--exit-code-from",
      "k6",
      "k6",
    ],
    { env: { K6_VUS: vus, K6_DURATION: duration } },
  );
  await writeLog("load", "k6.txt", result.output);
  await writeEvidence("load", {
    status: "passed",
    target: "isolated-synthetic-mock-contract",
    vus: Number(vus),
    duration,
    mockContractOnly: true,
    syntheticSingleSchedulerContractAsserted: true,
    syntheticCacheBoundaryContractAsserted: true,
    syntheticIdempotencyContractAsserted: true,
    stagingOrProductionEvidence: false,
  });
  console.log("EtkinLink bounded Docker load profile passed.");
} finally {
  compose(["--profile", "load", "down", "--remove-orphans"], {
    quiet: true,
    allowFailure: true,
  });
}

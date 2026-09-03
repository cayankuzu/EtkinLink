import {
  compose,
  repositoryRoot,
  resetEvidenceDirectory,
  run,
  writeEvidence,
  writeLog,
} from "./_common.mjs";

try {
  await resetEvidenceDirectory("resilience");
  run("node", ["infra/docker/scripts/validate-compose.mjs"], {
    cwd: repositoryRoot,
  });
  compose(["--profile", "resilience", "down", "--remove-orphans"], {
    quiet: true,
    allowFailure: true,
  });
  const result = compose([
    "--profile",
    "resilience",
    "up",
    "--build",
    "--abort-on-container-exit",
    "--exit-code-from",
    "resilience-tests",
    "resilience-tests",
  ]);
  await writeLog("resilience", "fault-injection.txt", result.output);
  await writeEvidence("resilience", {
    status: "passed",
    toxiproxy: true,
    mockContractOnly: true,
    syntheticUpstreamTimeoutRecovery: true,
    syntheticUpstreamLatencyRecovery: true,
    syntheticDuplicateFreeReplay: true,
    localSupabaseRealtimePushWorkerFaultEvidence: false,
  });
  console.log("EtkinLink Docker resilience profile passed.");
} finally {
  compose(["--profile", "resilience", "down", "--remove-orphans"], {
    quiet: true,
    allowFailure: true,
  });
}

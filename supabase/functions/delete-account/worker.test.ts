import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { createWorkerSignature } from "../_shared/workerAuth.ts";
import type { AccountDeletionState } from "./handler.ts";
import {
  type AccountDeletionContinuationClaim,
  type AccountDeletionWorkerDependencies,
  handleAccountDeletionContinuationWorker,
  isAccountDeletionWorkerRequest,
} from "./worker.ts";

const nowMs = 1_788_091_200_000;
const secret = "account-deletion-worker-secret-1234567890";
const nonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";

type Writes = {
  consumedNonces: string[];
  claimedBatchSizes: number[];
  transitions: Array<[string, string]>;
  removedPaths: string[][];
  releases: Array<{
    outcome: "completed" | "resumable" | "failed";
    errorCode: string | null;
  }>;
};

function state(phase: AccountDeletionState["phase"]): AccountDeletionState {
  return {
    userId,
    clientRequestId: requestId,
    phase,
    recentLoginVerifiedAt: "2026-08-30T12:00:00.000Z",
    attemptCount: 1,
    lastErrorCode: null,
    updatedAt: "2026-08-30T12:00:00.000Z",
  };
}

function claim(
  phase: AccountDeletionContinuationClaim["phase"] = "auth_deleted",
  attemptCount = 1,
): AccountDeletionContinuationClaim {
  return { userId, clientRequestId: requestId, phase, attemptCount };
}

function dependencies(options: {
  claims?: AccountDeletionContinuationClaim[];
  initialPhase?: AccountDeletionState["phase"];
  pages?: string[][];
  nonceAccepted?: boolean;
  releaseAccepted?: boolean;
  terminal?: boolean;
} = {}): { dependencies: AccountDeletionWorkerDependencies; writes: Writes } {
  let current = state(options.initialPhase ?? "auth_deleted");
  const pages = [...(options.pages ?? [[]])];
  const writes: Writes = {
    consumedNonces: [],
    claimedBatchSizes: [],
    transitions: [],
    removedPaths: [],
    releases: [],
  };
  return {
    writes,
    dependencies: {
      now: () => nowMs,
      workerSecret: () => secret,
      consumeNonce: async (value) => {
        writes.consumedNonces.push(value);
        return options.nonceAccepted ?? true;
      },
      claimContinuations: async (batchSize) => {
        writes.claimedBatchSizes.push(batchSize);
        return options.claims ?? [claim()];
      },
      getRequest: async () => current,
      advanceRequest: async (
        _userId,
        _clientRequestId,
        expectedPhase,
        nextPhase,
      ) => {
        if (current.phase !== expectedPhase) throw new Error("phase conflict");
        writes.transitions.push([expectedPhase, nextPhase]);
        current = { ...current, phase: nextPhase };
        return current;
      },
      listStoragePaths: async () => pages.shift() ?? [],
      removeStoragePaths: async (paths) => {
        writes.removedPaths.push(paths);
      },
      releaseContinuation: async (_claim, outcome, errorCode) => {
        writes.releases.push({ outcome, errorCode });
        return {
          accepted: options.releaseAccepted ?? true,
          terminal: options.terminal ?? false,
          nextAttemptAt: outcome === "completed"
            ? null
            : "2026-08-30T12:01:00.000Z",
        };
      },
    },
  };
}

async function request(
  body = '{"drain":true,"batchSize":5}',
  requestNonce = nonce,
): Promise<Request> {
  const timestamp = Math.floor(nowMs / 1000);
  const signature = await createWorkerSignature(
    secret,
    timestamp,
    requestNonce,
    "delete-account-continuation",
    body,
  );
  return new Request("https://example.test/functions/v1/delete-account", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-push-worker-timestamp": String(timestamp),
      "x-push-worker-nonce": requestNonce,
      "x-push-worker-signature": signature,
    },
    body,
  });
}

Deno.test("continuation worker requires a valid body-bound HMAC and fresh nonce", async () => {
  const first = dependencies();
  const unsigned = await handleAccountDeletionContinuationWorker(
    new Request("https://example.test/functions/v1/delete-account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"drain":true,"batchSize":5}',
    }),
    first.dependencies,
  );
  assertEquals(unsigned.status, 401);
  assertEquals(first.writes.claimedBatchSizes, []);

  const replay = dependencies({ nonceAccepted: false });
  const replayed = await handleAccountDeletionContinuationWorker(
    await request(),
    replay.dependencies,
  );
  assertEquals(replayed.status, 401);
  assertEquals(replay.writes.consumedNonces, [nonce]);
  assertEquals(replay.writes.claimedBatchSizes, []);
});

Deno.test("continuation worker rejects malformed and oversized drain commands", async () => {
  const malformed = dependencies();
  const malformedResponse = await handleAccountDeletionContinuationWorker(
    await request('{"drain":true,"batchSize":11}'),
    malformed.dependencies,
  );
  assertEquals(malformedResponse.status, 400);
  assertEquals(malformed.writes.consumedNonces, []);

  const oversizedBody = JSON.stringify({
    drain: true,
    batchSize: 5,
    padding: "x".repeat(1100),
  });
  const oversized = dependencies();
  const oversizedResponse = await handleAccountDeletionContinuationWorker(
    await request(oversizedBody),
    oversized.dependencies,
  );
  assertEquals(oversizedResponse.status, 413);
});

Deno.test("continuation worker deletes legacy owner paths and completes the saga", async () => {
  const ownedPath =
    "11111111-1111-4111-8111-111111111111/legacy/deep/photo.webp";
  const fixture = dependencies({ pages: [[ownedPath], []] });
  const signedRequest = await request();
  assert(isAccountDeletionWorkerRequest(signedRequest));

  const response = await handleAccountDeletionContinuationWorker(
    signedRequest,
    fixture.dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    claimed: 1,
    completed: 1,
    resumable: 0,
    failed: 0,
    terminal: 0,
  });
  assertEquals(fixture.writes.claimedBatchSizes, [5]);
  assertEquals(fixture.writes.transitions, [
    ["auth_deleted", "storage_deleting"],
    ["storage_deleting", "completed"],
  ]);
  assertEquals(fixture.writes.removedPaths, [[ownedPath]]);
  assertEquals(fixture.writes.releases, [
    { outcome: "completed", errorCode: null },
  ]);
});

Deno.test("continuation worker bounds each claim and schedules remaining objects", async () => {
  const pages = Array.from(
    { length: 5 },
    (_, pageIndex) =>
      Array.from({ length: 100 }, (_, itemIndex) => {
        const suffix = String(pageIndex * 100 + itemIndex).padStart(4, "0");
        return `${userId}/legacy/${suffix}.jpg`;
      }),
  );
  const fixture = dependencies({
    claims: [claim("storage_deleting")],
    initialPhase: "storage_deleting",
    pages,
  });
  const response = await handleAccountDeletionContinuationWorker(
    await request(),
    fixture.dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json()).resumable, 1);
  assertEquals(fixture.writes.removedPaths.length, 5);
  assertEquals(
    fixture.writes.removedPaths.flat().length,
    500,
    "one lease has a hard object bound",
  );
  assertEquals(fixture.writes.releases, [
    { outcome: "resumable", errorCode: null },
  ]);
});

Deno.test("continuation failure is sanitized, terminalized, and never deletes another owner", async () => {
  const fixture = dependencies({
    claims: [claim("storage_deleting", 8)],
    initialPhase: "storage_deleting",
    pages: [["99999999-9999-4999-8999-999999999999/private.jpg"]],
    terminal: true,
  });
  const response = await handleAccountDeletionContinuationWorker(
    await request(),
    fixture.dependencies,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    claimed: 1,
    completed: 0,
    resumable: 0,
    failed: 1,
    terminal: 1,
  });
  assertEquals(fixture.writes.removedPaths, []);
  assertEquals(fixture.writes.releases, [{
    outcome: "failed",
    errorCode: "CONTINUATION_STORAGE_LIST_INVALID",
  }]);
});

Deno.test("continuation claim release conflicts fail closed", async () => {
  const fixture = dependencies({
    claims: [claim("storage_deleting")],
    initialPhase: "storage_deleting",
    pages: [[]],
    releaseAccepted: false,
  });
  const response = await handleAccountDeletionContinuationWorker(
    await request(),
    fixture.dependencies,
  );
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    code: "CONTINUATION_RELEASE_CONFLICT",
  });
});

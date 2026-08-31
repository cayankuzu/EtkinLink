import { authorizeWorkerRequest } from "../_shared/workerAuth.ts";
import type {
  AccountDeletionDependencies,
  AccountDeletionPhase,
  AccountDeletionState,
} from "./handler.ts";

const WORKER_SCOPE = "delete-account-continuation";
const MAX_WORKER_BODY_BYTES = 1024;
const STORAGE_PAGE_SIZE = 100;
const MAX_STORAGE_OBJECTS_PER_CLAIM = 500;

export type AccountDeletionContinuationClaim = {
  userId: string;
  clientRequestId: string;
  phase: "auth_deleted" | "storage_deleting";
  attemptCount: number;
};

export type AccountDeletionContinuationRelease = {
  accepted: boolean;
  terminal: boolean;
  nextAttemptAt: string | null;
};

export type AccountDeletionWorkerDependencies =
  & Pick<
    AccountDeletionDependencies,
    | "getRequest"
    | "advanceRequest"
    | "listStoragePaths"
    | "removeStoragePaths"
  >
  & {
    now: () => number;
    workerSecret: () => string | undefined;
    consumeNonce: (nonce: string, timestamp: number) => Promise<boolean>;
    claimContinuations: (
      batchSize: number,
    ) => Promise<AccountDeletionContinuationClaim[]>;
    releaseContinuation: (
      claim: AccountDeletionContinuationClaim,
      outcome: "completed" | "resumable" | "failed",
      errorCode: string | null,
    ) => Promise<AccountDeletionContinuationRelease>;
  };

class WorkerRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class ContinuationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function mediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readBoundedBody(request: Request): Promise<string> {
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    throw new WorkerRequestError(
      415,
      "APPLICATION_JSON_REQUIRED",
      "Content-Type application/json is required.",
    );
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) {
      throw new WorkerRequestError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Content-Length is invalid.",
      );
    }
    if (Number(contentLength) > MAX_WORKER_BODY_BYTES) {
      throw new WorkerRequestError(
        413,
        "REQUEST_BODY_TOO_LARGE",
        "Request body is too large.",
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new WorkerRequestError(400, "INVALID_JSON_BODY", "Body is required.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_WORKER_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The byte limit remains authoritative.
        }
        throw new WorkerRequestError(
          413,
          "REQUEST_BODY_TOO_LARGE",
          "Request body is too large.",
        );
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (error instanceof WorkerRequestError) throw error;
    throw new WorkerRequestError(400, "INVALID_JSON_BODY", "Body is invalid.");
  } finally {
    reader.releaseLock();
  }
  return parts.join("");
}

function parseDrainCommand(rawBody: string): number {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new WorkerRequestError(400, "INVALID_JSON_BODY", "Body is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerRequestError(
      400,
      "INVALID_DRAIN_COMMAND",
      "Command is invalid.",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["drain", "batchSize"].includes(key)) ||
    record.drain !== true ||
    !Number.isInteger(record.batchSize) ||
    (record.batchSize as number) < 1 ||
    (record.batchSize as number) > 10
  ) {
    throw new WorkerRequestError(
      400,
      "INVALID_DRAIN_COMMAND",
      "Command is invalid.",
    );
  }
  return record.batchSize as number;
}

function storagePathIsOwned(path: string, userId: string): boolean {
  return path.length > userId.length + 1 &&
    path.indexOf("/") === userId.length &&
    path.slice(0, userId.length).toLowerCase() === userId;
}

async function currentState(
  dependencies: AccountDeletionWorkerDependencies,
  claim: AccountDeletionContinuationClaim,
): Promise<AccountDeletionState> {
  let state: AccountDeletionState | null;
  try {
    state = await dependencies.getRequest(claim.clientRequestId);
  } catch {
    throw new ContinuationError("CONTINUATION_STATE_READ_FAILED");
  }
  if (!state || state.userId.toLowerCase() !== claim.userId) {
    throw new ContinuationError("CONTINUATION_STATE_INVALID");
  }
  return state;
}

async function advancePhase(
  dependencies: AccountDeletionWorkerDependencies,
  state: AccountDeletionState,
  nextPhase: AccountDeletionPhase,
): Promise<AccountDeletionState> {
  try {
    return await dependencies.advanceRequest(
      state.userId,
      state.clientRequestId,
      state.phase,
      nextPhase,
      null,
    );
  } catch {
    const recovered = await currentState(dependencies, {
      userId: state.userId.toLowerCase(),
      clientRequestId: state.clientRequestId,
      phase: state.phase === "auth_deleted"
        ? "auth_deleted"
        : "storage_deleting",
      attemptCount: 1,
    });
    const rank: Record<AccountDeletionPhase, number> = {
      requested: 0,
      auth_deleted: 1,
      storage_deleting: 2,
      completed: 3,
    };
    if (rank[recovered.phase] >= rank[nextPhase]) return recovered;
    throw new ContinuationError("CONTINUATION_STATE_WRITE_FAILED");
  }
}

async function processClaim(
  dependencies: AccountDeletionWorkerDependencies,
  claim: AccountDeletionContinuationClaim,
): Promise<"completed" | "resumable"> {
  let state = await currentState(dependencies, claim);
  if (state.phase === "completed") return "completed";
  if (state.phase === "auth_deleted") {
    state = await advancePhase(dependencies, state, "storage_deleting");
  }
  if (state.phase === "completed") return "completed";
  if (state.phase !== "storage_deleting") {
    throw new ContinuationError("CONTINUATION_STATE_INVALID");
  }

  let afterStoragePath: string | null = null;
  let removedCount = 0;
  while (removedCount < MAX_STORAGE_OBJECTS_PER_CLAIM) {
    let storagePaths: string[];
    try {
      storagePaths = await dependencies.listStoragePaths(
        claim.userId,
        claim.clientRequestId,
        afterStoragePath,
        STORAGE_PAGE_SIZE,
      );
    } catch {
      throw new ContinuationError("CONTINUATION_STORAGE_LIST_FAILED");
    }
    if (
      storagePaths.length > STORAGE_PAGE_SIZE ||
      storagePaths.some((path) =>
        typeof path !== "string" || !storagePathIsOwned(path, claim.userId)
      )
    ) {
      throw new ContinuationError("CONTINUATION_STORAGE_LIST_INVALID");
    }
    if (storagePaths.length === 0) break;

    try {
      await dependencies.removeStoragePaths(storagePaths);
    } catch {
      throw new ContinuationError("CONTINUATION_STORAGE_DELETE_FAILED");
    }
    removedCount += storagePaths.length;
    afterStoragePath = storagePaths.at(-1) ?? afterStoragePath;
  }

  if (removedCount >= MAX_STORAGE_OBJECTS_PER_CLAIM) return "resumable";
  state = await advancePhase(dependencies, state, "completed");
  if (state.phase !== "completed") {
    throw new ContinuationError("CONTINUATION_COMPLETE_FAILED");
  }
  return "completed";
}

export function isAccountDeletionWorkerRequest(request: Request): boolean {
  return [
    "x-push-worker-timestamp",
    "x-push-worker-nonce",
    "x-push-worker-signature",
  ].some((header) => request.headers.has(header));
}

export async function handleAccountDeletionContinuationWorker(
  request: Request,
  dependencies: AccountDeletionWorkerDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(405, { code: "METHOD_NOT_ALLOWED" });
  }

  let rawBody: string;
  let batchSize: number;
  try {
    rawBody = await readBoundedBody(request);
    batchSize = parseDrainCommand(rawBody);
  } catch (error) {
    if (error instanceof WorkerRequestError) {
      return jsonResponse(error.status, { code: error.code });
    }
    return jsonResponse(400, { code: "INVALID_JSON_BODY" });
  }

  const secret = dependencies.workerSecret() ?? "";
  const authorization = await authorizeWorkerRequest(
    request,
    secret,
    WORKER_SCOPE,
    rawBody,
    dependencies.now(),
  );
  if (!authorization) {
    return jsonResponse(401, { code: "WORKER_AUTH_INVALID" });
  }
  let nonceAccepted: boolean;
  try {
    nonceAccepted = await dependencies.consumeNonce(
      authorization.nonce,
      authorization.timestamp,
    );
  } catch {
    return jsonResponse(500, { code: "WORKER_NONCE_PERSIST_FAILED" });
  }
  if (!nonceAccepted) {
    return jsonResponse(401, { code: "WORKER_REQUEST_REPLAYED" });
  }

  let claims: AccountDeletionContinuationClaim[];
  try {
    claims = await dependencies.claimContinuations(batchSize);
  } catch {
    return jsonResponse(500, { code: "CONTINUATION_CLAIM_FAILED" });
  }

  let completed = 0;
  let resumable = 0;
  let failed = 0;
  let terminal = 0;
  for (const claim of claims) {
    let outcome: "completed" | "resumable" | "failed";
    let errorCode: string | null = null;
    try {
      outcome = await processClaim(dependencies, claim);
    } catch (error) {
      outcome = "failed";
      errorCode = error instanceof ContinuationError
        ? error.code
        : "CONTINUATION_UNEXPECTED";
    }

    let release: AccountDeletionContinuationRelease;
    try {
      release = await dependencies.releaseContinuation(
        claim,
        outcome,
        errorCode,
      );
    } catch {
      return jsonResponse(500, { code: "CONTINUATION_RELEASE_FAILED" });
    }
    if (!release.accepted) {
      return jsonResponse(500, { code: "CONTINUATION_RELEASE_CONFLICT" });
    }

    if (outcome === "completed") completed += 1;
    else if (outcome === "resumable") resumable += 1;
    else failed += 1;
    if (release.terminal) terminal += 1;
  }

  return jsonResponse(200, {
    claimed: claims.length,
    completed,
    resumable,
    failed,
    terminal,
  });
}

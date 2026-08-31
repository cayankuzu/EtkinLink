// deno-lint-ignore-file no-import-prefix
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.1";

import {
  type AccountDeletionDependencies,
  type AccountDeletionPhase,
  type AccountDeletionState,
  createDeleteAccountHandler,
} from "./handler.ts";
import {
  type AccountDeletionContinuationClaim,
  type AccountDeletionContinuationRelease,
  type AccountDeletionWorkerDependencies,
  handleAccountDeletionContinuationWorker,
  isAccountDeletionWorkerRequest,
} from "./worker.ts";

type AccountDeletionRow = {
  user_id: unknown;
  client_request_id: unknown;
  phase: unknown;
  recent_login_verified_at: unknown;
  attempt_count: unknown;
  last_error_code: unknown;
  updated_at: unknown;
};

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type VerificationTransport = {
  fetcher?: FetchLike;
  timeoutSignal?: (milliseconds: number) => AbortSignal;
};

export const POSTGREST_VERIFY_TIMEOUT_MS = 10_000;
export const MAX_POSTGREST_RESPONSE_BYTES = 16 * 1024;

const DELETION_PHASES = new Set<AccountDeletionPhase>([
  "requested",
  "auth_deleted",
  "storage_deleting",
  "completed",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, code: string, error: string): Response {
  return new Response(JSON.stringify({ code, error }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function mapState(value: unknown): AccountDeletionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ACCOUNT_DELETION_STATE_INVALID");
  }

  const row = value as AccountDeletionRow;
  if (
    typeof row.user_id !== "string" ||
    typeof row.client_request_id !== "string" ||
    typeof row.phase !== "string" ||
    !DELETION_PHASES.has(row.phase as AccountDeletionPhase) ||
    typeof row.recent_login_verified_at !== "string" ||
    typeof row.attempt_count !== "number" ||
    !Number.isInteger(row.attempt_count) ||
    row.attempt_count < 0 ||
    (row.last_error_code !== null &&
      typeof row.last_error_code !== "string") ||
    typeof row.updated_at !== "string"
  ) {
    throw new Error("ACCOUNT_DELETION_STATE_INVALID");
  }

  return {
    userId: row.user_id,
    clientRequestId: row.client_request_id,
    phase: row.phase as AccountDeletionPhase,
    recentLoginVerifiedAt: row.recent_login_verified_at,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code,
    updatedAt: row.updated_at,
  };
}

function verificationEndpoint(supabaseUrl: string): URL {
  let base: URL;
  try {
    base = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL_INVALID");
  }
  if (
    base.protocol !== "https:" ||
    base.username !== "" ||
    base.password !== "" ||
    base.pathname !== "/" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw new Error("SUPABASE_URL_INVALID");
  }

  const endpoint = new URL(
    "/rest/v1/rpc/get_verified_account_deletion_claims",
    base,
  );
  if (endpoint.protocol !== "https:" || endpoint.origin !== base.origin) {
    throw new Error("SUPABASE_URL_INVALID");
  }
  return endpoint;
}

function isJsonMediaType(value: string | null): boolean {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  if (!isJsonMediaType(response.headers.get("content-type"))) {
    throw new Error("TOKEN_VERIFY_RESPONSE_INVALID");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) {
      throw new Error("TOKEN_VERIFY_RESPONSE_INVALID");
    }
    if (Number(contentLength) > MAX_POSTGREST_RESPONSE_BYTES) {
      throw new Error("TOKEN_VERIFY_RESPONSE_TOO_LARGE");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("TOKEN_VERIFY_RESPONSE_INVALID");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_POSTGREST_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The byte limit is authoritative even if stream cancellation fails.
        }
        throw new Error("TOKEN_VERIFY_RESPONSE_TOO_LARGE");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "TOKEN_VERIFY_RESPONSE_TOO_LARGE"
    ) {
      throw error;
    }
    throw new Error("TOKEN_VERIFY_RESPONSE_INVALID");
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(parts.join(""));
  } catch {
    throw new Error("TOKEN_VERIFY_RESPONSE_INVALID");
  }
}

export async function verifyTokenThroughPostgrest(
  supabaseUrl: string,
  anonKey: string,
  token: string,
  transport: VerificationTransport = {},
): Promise<{ sub: string; iat: number }> {
  const endpoint = verificationEndpoint(supabaseUrl);
  const fetcher = transport.fetcher ?? fetch;
  const timeoutSignal = transport.timeoutSignal ?? AbortSignal.timeout;
  const response = await fetcher(endpoint, {
    method: "POST",
    redirect: "error",
    signal: timeoutSignal(POSTGREST_VERIFY_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (
    !response.ok ||
    response.redirected ||
    (response.url !== "" && new URL(response.url).origin !== endpoint.origin)
  ) {
    throw new Error("TOKEN_INVALID");
  }

  const payload = await readBoundedJsonResponse(response);
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error("TOKEN_INVALID");
  }
  const row = payload[0] as {
    user_id?: unknown;
    issued_at?: unknown;
  };
  const issuedAt = typeof row.issued_at === "string"
    ? Number(row.issued_at)
    : row.issued_at;
  if (
    typeof row.user_id !== "string" ||
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt)
  ) {
    throw new Error("TOKEN_INVALID");
  }
  return { sub: row.user_id, iat: issuedAt };
}

export function createDependencies(
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
): AccountDeletionDependencies {
  return {
    now: () => Date.now(),

    async verifyToken(token) {
      return await verifyTokenThroughPostgrest(supabaseUrl, anonKey, token);
    },

    async getRequest(clientRequestId) {
      const { data, error } = await admin.rpc(
        "get_account_deletion_request",
        { target_client_request_id: clientRequestId },
      ).maybeSingle();
      if (error) throw error;
      return data === null ? null : mapState(data);
    },

    async beginRequest(userId, clientRequestId) {
      const { data, error } = await admin.rpc(
        "begin_account_deletion_request",
        {
          target_user_id: userId,
          target_client_request_id: clientRequestId,
        },
      ).single();
      if (error) throw error;
      return mapState(data);
    },

    async advanceRequest(
      userId,
      clientRequestId,
      expectedPhase,
      nextPhase,
      errorCode,
    ) {
      const { data, error } = await admin.rpc(
        "advance_account_deletion_request",
        {
          target_user_id: userId,
          target_client_request_id: clientRequestId,
          expected_phase: expectedPhase,
          next_phase: nextPhase,
          error_code: errorCode,
        },
      ).single();
      if (error) throw error;
      return mapState(data);
    },

    async getAuthState(userId) {
      const { data, error } = await admin.rpc(
        "get_account_deletion_auth_state",
        { target_user_id: userId },
      ).single();
      if (error) throw error;
      const row = data as {
        user_exists?: unknown;
        last_sign_in_at?: unknown;
      } | null;
      if (
        !row ||
        typeof row.user_exists !== "boolean" ||
        (row.last_sign_in_at !== null &&
          typeof row.last_sign_in_at !== "string")
      ) {
        throw new Error("ACCOUNT_DELETION_AUTH_STATE_INVALID");
      }
      return {
        exists: row.user_exists,
        lastSignInAt: row.last_sign_in_at,
      };
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (error) throw error;
    },

    async listStoragePaths(
      userId,
      clientRequestId,
      afterStoragePath,
      pageSize,
    ) {
      const { data, error } = await admin.rpc(
        "list_account_deletion_storage_paths",
        {
          target_user_id: userId,
          target_client_request_id: clientRequestId,
          after_storage_path: afterStoragePath,
          page_size: pageSize,
        },
      );
      if (error) throw error;
      if (!Array.isArray(data)) {
        throw new Error("ACCOUNT_DELETION_STORAGE_LIST_INVALID");
      }
      return data.map((row: unknown) => {
        if (
          !row ||
          typeof row !== "object" ||
          typeof (row as { storage_path?: unknown }).storage_path !== "string"
        ) {
          throw new Error("ACCOUNT_DELETION_STORAGE_LIST_INVALID");
        }
        return (row as { storage_path: string }).storage_path;
      });
    },

    async removeStoragePaths(storagePaths) {
      if (storagePaths.length === 0) return;
      const { error } = await admin.storage
        .from("profile-photos")
        .remove(storagePaths);
      if (error) throw error;
    },
  };
}

let cachedHandler: ((request: Request) => Promise<Response>) | null = null;
let cachedWorker:
  | ((request: Request) => Promise<Response>)
  | null = null;

function createWorkerDependencies(
  admin: SupabaseClient,
  accountDependencies: AccountDeletionDependencies,
): AccountDeletionWorkerDependencies {
  return {
    now: accountDependencies.now,
    workerSecret: () => Deno.env.get("ACCOUNT_DELETION_WORKER_SECRET"),
    getRequest: accountDependencies.getRequest,
    advanceRequest: accountDependencies.advanceRequest,
    listStoragePaths: accountDependencies.listStoragePaths,
    removeStoragePaths: accountDependencies.removeStoragePaths,

    async consumeNonce(nonce, timestamp) {
      const { data, error } = await admin.rpc(
        "consume_account_deletion_worker_nonce",
        { request_nonce: nonce, request_timestamp: timestamp },
      );
      if (error || typeof data !== "boolean") {
        throw error ?? new Error("ACCOUNT_DELETION_NONCE_RESULT_INVALID");
      }
      return data;
    },

    async claimContinuations(batchSize) {
      const { data, error } = await admin.rpc(
        "claim_account_deletion_continuations",
        { requested_batch_size: batchSize },
      );
      if (error || !Array.isArray(data)) {
        throw error ?? new Error("ACCOUNT_DELETION_CLAIMS_INVALID");
      }
      return data.map((value: unknown): AccountDeletionContinuationClaim => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("ACCOUNT_DELETION_CLAIM_INVALID");
        }
        const row = value as Record<string, unknown>;
        if (
          typeof row.user_id !== "string" ||
          !UUID_PATTERN.test(row.user_id) ||
          typeof row.client_request_id !== "string" ||
          !UUID_PATTERN.test(row.client_request_id) ||
          (row.phase !== "auth_deleted" && row.phase !== "storage_deleting") ||
          typeof row.continuation_attempt_count !== "number" ||
          !Number.isInteger(row.continuation_attempt_count) ||
          row.continuation_attempt_count < 1 ||
          row.continuation_attempt_count > 8
        ) {
          throw new Error("ACCOUNT_DELETION_CLAIM_INVALID");
        }
        return {
          userId: row.user_id.toLowerCase(),
          clientRequestId: row.client_request_id.toLowerCase(),
          phase: row.phase,
          attemptCount: row.continuation_attempt_count,
        };
      });
    },

    async releaseContinuation(claim, outcome, errorCode) {
      const { data, error } = await admin.rpc(
        "release_account_deletion_continuation_claim",
        {
          target_user_id: claim.userId,
          target_client_request_id: claim.clientRequestId,
          expected_attempt_count: claim.attemptCount,
          outcome,
          error_code: errorCode,
        },
      ).single();
      if (error || !data || typeof data !== "object") {
        throw error ?? new Error("ACCOUNT_DELETION_RELEASE_INVALID");
      }
      const row = data as Record<string, unknown>;
      if (
        typeof row.accepted !== "boolean" ||
        typeof row.terminal !== "boolean" ||
        (row.next_attempt_at !== null &&
          typeof row.next_attempt_at !== "string")
      ) {
        throw new Error("ACCOUNT_DELETION_RELEASE_INVALID");
      }
      return {
        accepted: row.accepted,
        terminal: row.terminal,
        nextAttemptAt: row.next_attempt_at,
      } satisfies AccountDeletionContinuationRelease;
    },
  };
}

export async function handleDeleteAccountRequest(
  request: Request,
): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      500,
      "SERVER_CONFIGURATION_MISSING",
      "Server configuration is incomplete.",
    );
  }

  if (!cachedHandler || !cachedWorker) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const accountDependencies = createDependencies(admin, supabaseUrl, anonKey);
    cachedHandler = createDeleteAccountHandler(accountDependencies);
    const workerDependencies = createWorkerDependencies(
      admin,
      accountDependencies,
    );
    cachedWorker = (workerRequest) =>
      handleAccountDeletionContinuationWorker(
        workerRequest,
        workerDependencies,
      );
  }
  if (isAccountDeletionWorkerRequest(request)) {
    return await cachedWorker(request);
  }
  return await cachedHandler(request);
}

export { createDeleteAccountHandler } from "./handler.ts";

if (import.meta.main) Deno.serve(handleDeleteAccountRequest);

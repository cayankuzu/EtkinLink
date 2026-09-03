import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.1";
import {
  BoundedJsonError,
  readBoundedJsonRequest,
} from "../_shared/boundedJson.ts";
import {
  ExpoHttpError,
  fetchExpoJsonWithRetry,
  isTransientExpoStatus,
} from "../_shared/expoHttp.ts";
import { authorizeWorkerRequest } from "../_shared/workerAuth.ts";

const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_RECEIPTS_PER_REQUEST = 300;
const MAX_RECEIPT_ATTEMPTS = 5;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;
const MAX_EXPO_RESPONSE_BYTES = 512 * 1024;
const RETRYABLE_EXPO_ERRORS = new Set([
  "ExpoServerError",
  "InternalServerError",
  "MessageRateExceeded",
  "ServiceUnavailable",
]);

export type Receipt = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

type ReceiptState =
  | "delivered"
  | "invalid_token"
  | "retryable"
  | "permanent_failure";

type PendingDelivery = {
  id: string;
  expo_ticket_id: string;
  push_token_id: string;
  receipt_attempt_count: number | null;
  receipt_lease_id: string;
};

export type PushReceiptDependencies = {
  getEnv?: (name: string) => string | undefined;
  createAdmin?: (url: string, serviceRoleKey: string) => SupabaseClient;
  fetch?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function classifyReceipt(receipt: Receipt): ReceiptState {
  if (receipt.status === "ok") return "delivered";
  const errorCode = receipt.details?.error ?? "UNKNOWN_RECEIPT_ERROR";
  if (errorCode === "DeviceNotRegistered") return "invalid_token";
  if (RETRYABLE_EXPO_ERRORS.has(errorCode)) return "retryable";
  return "permanent_failure";
}

function boundedOptionalString(
  value: unknown,
  maxLength: number,
): string | undefined {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : undefined;
}

function normalizeReceipt(rawReceipt: unknown): Receipt {
  if (!rawReceipt || typeof rawReceipt !== "object") {
    throw new Error("Expo receipt shape is invalid.");
  }
  const candidate = rawReceipt as Record<string, unknown>;
  if (candidate.status !== "ok" && candidate.status !== "error") {
    throw new Error("Expo receipt status is invalid.");
  }
  const message = boundedOptionalString(candidate.message, 500);
  if (candidate.message !== undefined && message === undefined) {
    throw new Error("Expo receipt message is invalid.");
  }
  let errorCode: string | undefined;
  if (candidate.details !== undefined) {
    if (!candidate.details || typeof candidate.details !== "object") {
      throw new Error("Expo receipt details are invalid.");
    }
    const rawError = (candidate.details as Record<string, unknown>).error;
    errorCode = boundedOptionalString(rawError, 120);
    if (rawError !== undefined && errorCode === undefined) {
      throw new Error("Expo receipt error code is invalid.");
    }
  }
  if (candidate.status === "error" && !errorCode) {
    throw new Error("Failed Expo receipt is missing an error code.");
  }
  if (candidate.status === "ok" && errorCode !== undefined) {
    throw new Error("Successful Expo receipt includes an error code.");
  }
  return {
    status: candidate.status,
    ...(message !== undefined ? { message } : {}),
    ...(errorCode !== undefined ? { details: { error: errorCode } } : {}),
  };
}

function normalizeReceiptPayload(
  payload: unknown,
  requestedIds: string[],
): Record<string, Receipt> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Expo receipt response is invalid.");
  }
  const rawData = (payload as { data?: unknown }).data;
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new Error("Expo receipt response is missing data.");
  }
  const normalized: Record<string, Receipt> = {};
  for (const ticketId of requestedIds) {
    const rawReceipt = (rawData as Record<string, unknown>)[ticketId];
    if (rawReceipt !== undefined) {
      normalized[ticketId] = normalizeReceipt(rawReceipt);
    }
  }
  return normalized;
}

async function persistReceiptResult(
  admin: SupabaseClient,
  delivery: PendingDelivery,
  resultStatus: ReceiptState,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<boolean> {
  const { data, error } = await admin.rpc("persist_push_receipt_result", {
    target_delivery_id: delivery.id,
    expected_receipt_attempt_count: delivery.receipt_attempt_count ?? 0,
    expected_receipt_lease_id: delivery.receipt_lease_id,
    result_status: resultStatus,
    result_error_code: errorCode,
    result_error_message: errorMessage,
  });
  return error === null && data === true;
}

async function persistReceiptFetchFailure(
  admin: SupabaseClient,
  deliveries: PendingDelivery[],
  resultStatus: "retryable" | "permanent_failure",
  errorCode: string,
): Promise<boolean> {
  for (const delivery of deliveries) {
    if (
      !await persistReceiptResult(
        admin,
        delivery,
        resultStatus,
        errorCode,
        null,
      )
    ) return false;
  }
  return true;
}

export async function handlePushReceipts(
  request: Request,
  dependencies: PushReceiptDependencies = {},
): Promise<Response> {
  const getEnv = dependencies.getEnv ?? ((name: string) => Deno.env.get(name));
  const createAdmin = dependencies.createAdmin ??
    ((url: string, serviceRoleKey: string) =>
      createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }));
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST desteklenir." });
  }
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = getEnv("PUSH_WORKER_SECRET") ?? "";
  if (!supabaseUrl || !serviceRoleKey || workerSecret.length < 32) {
    return jsonResponse(500, { error: "Sunucu yapılandırması eksik." });
  }
  let rawBody: string;
  let requestBody: unknown;
  try {
    const parsed = await readBoundedJsonRequest(
      request,
      MAX_REQUEST_BODY_BYTES,
    );
    rawBody = parsed.rawBody;
    requestBody = parsed.value;
  } catch (error) {
    if (error instanceof BoundedJsonError) {
      return jsonResponse(error.status, { error: error.message });
    }
    return jsonResponse(400, { error: "Geçersiz JSON gövdesi." });
  }
  if (
    !requestBody || typeof requestBody !== "object" ||
    Array.isArray(requestBody) || Object.keys(requestBody).length !== 0
  ) {
    return jsonResponse(400, {
      error: "Worker komutu tam olarak {} olmalıdır.",
    });
  }
  const workerAuthorization = await authorizeWorkerRequest(
    request,
    workerSecret,
    "push-receipts",
    rawBody,
  );
  if (!workerAuthorization) {
    return jsonResponse(401, { error: "Yetkisiz worker çağrısı." });
  }

  const admin = createAdmin(supabaseUrl, serviceRoleKey);
  const { data: nonceAccepted, error: nonceError } = await admin.rpc(
    "consume_push_worker_nonce",
    {
      request_nonce: workerAuthorization.nonce,
      request_scope: workerAuthorization.scope,
      request_timestamp: workerAuthorization.timestamp,
    },
  );
  if (nonceError) {
    return jsonResponse(500, { error: "Worker yetkisi doğrulanamadı." });
  }
  if (nonceAccepted !== true) {
    return jsonResponse(401, { error: "Worker isteği daha önce kullanılmış." });
  }
  const { data, error } = await admin.rpc("claim_pending_push_receipts", {
    requested_batch_size: MAX_RECEIPTS_PER_REQUEST,
  });
  if (error) {
    return jsonResponse(500, { error: "Teslimat kayıtları okunamadı." });
  }
  const deliveries = (Array.isArray(data) ? data : []) as PendingDelivery[];
  if (deliveries.length === 0) return jsonResponse(200, { checked: 0 });

  const requestedIds = deliveries.map((item) => item.expo_ticket_id);
  let receipts: Record<string, Receipt>;
  try {
    const payload = await fetchExpoJsonWithRetry(EXPO_RECEIPTS_URL, {
      fetch: fetchImpl,
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(getEnv("EXPO_ACCESS_TOKEN")
            ? { authorization: `Bearer ${getEnv("EXPO_ACCESS_TOKEN")}` }
            : {}),
        },
        body: JSON.stringify({ ids: requestedIds }),
      },
      maxResponseBytes: MAX_EXPO_RESPONSE_BYTES,
      sleep,
    });
    receipts = normalizeReceiptPayload(payload, requestedIds);
  } catch (error) {
    // A syntactically malformed or oversized successful response is a
    // provider protocol failure, not proof of a permanent delivery failure.
    // Consume one durable attempt and let the DB-owned bounded backoff retry.
    const transient = !(error instanceof ExpoHttpError) ||
      error.status === null || isTransientExpoStatus(error.status);
    const errorCode = !(error instanceof ExpoHttpError)
      ? "EXPO_PROTOCOL_ERROR"
      : transient
      ? "EXPO_TRANSIENT_FAILURE"
      : error.status !== null
      ? `EXPO_HTTP_${error.status}`
      : "EXPO_TRANSIENT_FAILURE";
    const persisted = await persistReceiptFetchFailure(
      admin,
      deliveries,
      transient ? "retryable" : "permanent_failure",
      errorCode,
    );
    if (!persisted) {
      return jsonResponse(500, {
        error: "Expo receipt hatası lease sahibi tarafından kaydedilemedi.",
      });
    }
    return jsonResponse(502, { error: "Expo receipt servisine ulaşılamadı." });
  }

  let checked = 0;
  let delivered = 0;
  let retryable = 0;
  let permanentFailure = 0;
  let invalidToken = 0;

  for (const delivery of deliveries) {
    const receipt = receipts[delivery.expo_ticket_id];
    const nextAttemptCount = Math.min(
      (delivery.receipt_attempt_count ?? 0) + 1,
      MAX_RECEIPT_ATTEMPTS,
    );
    const state = receipt ? classifyReceipt(receipt) : "retryable";
    const exhausted = state === "retryable" &&
      nextAttemptCount >= MAX_RECEIPT_ATTEMPTS;
    const finalState: ReceiptState = exhausted ? "permanent_failure" : state;
    const errorCode = receipt?.details?.error ??
      (receipt ? null : "RECEIPT_NOT_READY");

    const persisted = await persistReceiptResult(
      admin,
      delivery,
      state,
      errorCode,
      receipt?.message?.slice(0, 500) ?? null,
    );
    if (!persisted) {
      return jsonResponse(500, {
        error: "Teslimat sonucu lease sahibi tarafından kalıcılaştırılamadı.",
      });
    }

    checked += 1;
    if (finalState === "delivered") delivered += 1;
    if (finalState === "retryable") retryable += 1;
    if (finalState === "permanent_failure") permanentFailure += 1;
    if (finalState === "invalid_token") {
      invalidToken += 1;
    }
  }

  return jsonResponse(200, {
    checked,
    delivered,
    retryable,
    permanentFailure,
    invalidToken,
  });
}

if (import.meta.main) Deno.serve((request) => handlePushReceipts(request));

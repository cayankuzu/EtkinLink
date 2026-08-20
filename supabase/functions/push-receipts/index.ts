import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.1";
import { isAuthorizedWorker } from "../_shared/workerAuth.ts";

const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_RECEIPTS_PER_REQUEST = 300;
const MAX_RECEIPT_ATTEMPTS = 5;
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
};

export type PushReceiptDependencies = {
  getEnv?: (name: string) => string | undefined;
  createAdmin?: (url: string, serviceRoleKey: string) => SupabaseClient;
  fetch?: typeof fetch;
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

export function nextReceiptAttempt(attemptCount: number): string {
  const delayMinutes = Math.min(5 * 2 ** Math.max(attemptCount - 1, 0), 60);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
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
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST desteklenir." });
  }
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const workerSecret = getEnv("PUSH_WORKER_SECRET") ?? "";
  if (!supabaseUrl || !serviceRoleKey || workerSecret.length < 32) {
    return jsonResponse(500, { error: "Sunucu yapılandırması eksik." });
  }
  if (!isAuthorizedWorker(request, workerSecret)) {
    return jsonResponse(401, { error: "Yetkisiz worker çağrısı." });
  }

  const admin = createAdmin(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("claim_pending_push_receipts", {
    requested_batch_size: MAX_RECEIPTS_PER_REQUEST,
  });
  if (error) {
    return jsonResponse(500, { error: "Teslimat kayıtları okunamadı." });
  }
  const deliveries = (Array.isArray(data) ? data : []) as PendingDelivery[];
  if (deliveries.length === 0) return jsonResponse(200, { checked: 0 });

  let response: Response;
  try {
    response = await fetchImpl(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(getEnv("EXPO_ACCESS_TOKEN")
          ? { authorization: `Bearer ${getEnv("EXPO_ACCESS_TOKEN")}` }
          : {}),
      },
      body: JSON.stringify({
        ids: deliveries.map((item) => item.expo_ticket_id),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return jsonResponse(502, { error: "Expo receipt servisine ulaşılamadı." });
  }

  const payload = (await response.json()) as { data?: Record<string, Receipt> };
  if (!response.ok || !payload.data) {
    return jsonResponse(502, { error: "Expo receipt servisi yanıt vermedi." });
  }

  let checked = 0;
  let delivered = 0;
  let retryable = 0;
  let permanentFailure = 0;
  let invalidToken = 0;

  for (const delivery of deliveries) {
    const receipt = payload.data[delivery.expo_ticket_id];
    const nextAttemptCount = (delivery.receipt_attempt_count ?? 0) + 1;
    const state = receipt ? classifyReceipt(receipt) : "retryable";
    const exhausted = state === "retryable" &&
      nextAttemptCount >= MAX_RECEIPT_ATTEMPTS;
    const finalState: ReceiptState = exhausted ? "permanent_failure" : state;
    const isFinal = finalState !== "retryable";
    const errorCode = receipt?.details?.error ??
      (receipt ? null : "RECEIPT_NOT_READY");

    const { error: updateError } = await admin
      .from("notification_deliveries")
      .update({
        receipt_status: finalState,
        receipt_attempt_count: nextAttemptCount,
        receipt_next_attempt_at: isFinal
          ? null
          : nextReceiptAttempt(nextAttemptCount),
        receipt_checked_at: isFinal ? new Date().toISOString() : null,
        receipt_error_code: errorCode,
        error_message: receipt?.message?.slice(0, 500) ?? null,
      })
      .eq("id", delivery.id);
    if (updateError) continue;

    checked += 1;
    if (finalState === "delivered") delivered += 1;
    if (finalState === "retryable") retryable += 1;
    if (finalState === "permanent_failure") permanentFailure += 1;
    if (finalState === "invalid_token") {
      invalidToken += 1;
      await admin
        .from("push_tokens")
        .update({ disabled_at: new Date().toISOString() })
        .eq("id", delivery.push_token_id);
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

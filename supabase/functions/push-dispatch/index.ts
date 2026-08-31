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

type PushToken = {
  id: string;
  token: string;
  platform: "android" | "ios";
};

type NotificationEvent = {
  id: string;
  user_id: string;
  kind: string;
  route_kind: string | null;
  route_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  channel_id: string;
  attempt_count: number;
};

type ClaimedNotification = {
  event: NotificationEvent;
  tokens: PushToken[];
};

type ExpoTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

type DeliveryResult = {
  eventId: string;
  delivered: number;
  failed: number;
  skipped?: boolean;
};

class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceError";
  }
}

class DeliveryProviderError extends Error {
  constructor(readonly retryable: boolean) {
    super(retryable ? "EXPO_TRANSIENT_FAILURE" : "EXPO_PERMANENT_FAILURE");
    this.name = "DeliveryProviderError";
  }
}

const RETRYABLE_EXPO_TICKET_ERRORS = new Set([
  "ExpoServerError",
  "InternalServerError",
  "MessageRateExceeded",
  "ServiceUnavailable",
]);

export type PushDispatchDependencies = {
  getEnv?: (name: string) => string | undefined;
  createAdmin?: (url: string, serviceRoleKey: string) => SupabaseClient;
  fetch?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_MESSAGES_PER_REQUEST = 100;
const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 25;
const MAX_CONCURRENT_EVENTS = 4;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_EXPO_RESPONSE_BYTES = 512 * 1024;
const ANDROID_CHANNELS: Record<string, string> = {
  messages: "messages-v2",
  rooms: "rooms-v2",
  matches: "matches-v2",
  events: "events-v2",
  system: "system-v2",
};
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DispatchCommand =
  | { kind: "event"; eventId: string }
  | { kind: "drain"; batchSize: number };

function notificationTtlSeconds(kind: string): number {
  if (kind === "direct_message" || kind === "room_message") return 86_400;
  if (kind === "event_reminder") return 21_600;
  if (kind === "system") return 259_200;
  return 604_800;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseDispatchCommand(payload: unknown): DispatchCommand | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = payload as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    keys.length === 1 && keys[0] === "eventId" &&
    typeof value.eventId === "string" && UUID_PATTERN.test(value.eventId)
  ) {
    return { kind: "event", eventId: value.eventId.toLowerCase() };
  }
  if (
    (keys.length === 1 || keys.length === 2) &&
    keys.includes("drain") &&
    keys.every((key) => key === "drain" || key === "batchSize") &&
    value.drain === true
  ) {
    if (keys.includes("batchSize")) {
      if (
        !Number.isInteger(value.batchSize) ||
        (value.batchSize as number) < 1 ||
        (value.batchSize as number) > MAX_BATCH_SIZE
      ) {
        return null;
      }
      return { kind: "drain", batchSize: value.batchSize as number };
    }
    return { kind: "drain", batchSize: DEFAULT_BATCH_SIZE };
  }
  return null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : undefined;
}

function normalizeExpoTickets(
  payload: unknown,
  expectedCount: number,
): ExpoTicket[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) {
    throw new Error("Expo ticket response is missing data.");
  }
  const rawData = (payload as { data?: unknown }).data;
  const rawTickets = Array.isArray(rawData) ? rawData : [rawData];
  if (rawTickets.length !== expectedCount) {
    throw new Error("Expo ticket count does not match the message count.");
  }

  return rawTickets.map((rawTicket) => {
    if (!rawTicket || typeof rawTicket !== "object") {
      throw new Error("Expo ticket shape is invalid.");
    }
    const candidate = rawTicket as Record<string, unknown>;
    if (candidate.status !== "ok" && candidate.status !== "error") {
      throw new Error("Expo ticket status is invalid.");
    }
    const message = optionalBoundedString(candidate.message, 500);
    if (candidate.message !== undefined && message === undefined) {
      throw new Error("Expo ticket message is invalid.");
    }
    let errorCode: string | undefined;
    if (candidate.details !== undefined) {
      if (!candidate.details || typeof candidate.details !== "object") {
        throw new Error("Expo ticket details are invalid.");
      }
      const rawError = (candidate.details as Record<string, unknown>).error;
      errorCode = optionalBoundedString(rawError, 120);
      if (rawError !== undefined && errorCode === undefined) {
        throw new Error("Expo ticket error code is invalid.");
      }
    }
    const id = optionalBoundedString(candidate.id, 256);
    if (candidate.status === "ok" && (!id || id.trim().length === 0)) {
      throw new Error("Successful Expo ticket is missing its id.");
    }
    if (candidate.status === "ok" && errorCode !== undefined) {
      throw new Error("Successful Expo ticket includes an error code.");
    }
    return {
      status: candidate.status,
      ...(id ? { id } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(errorCode !== undefined ? { details: { error: errorCode } } : {}),
    };
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item === undefined) return;
        results[currentIndex] = await worker(item);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function sendExpoBatch(
  event: NotificationEvent,
  tokens: PushToken[],
  accessToken: string | null,
  fetchImpl: typeof fetch,
  sleep: (delayMs: number) => Promise<void>,
): Promise<ExpoTicket[]> {
  const collapseId = typeof event.payload.collapseId === "string"
    ? event.payload.collapseId.slice(0, 64)
    : null;
  const notificationTag = typeof event.payload.notificationTag === "string"
    ? event.payload.notificationTag.slice(0, 64)
    : null;
  const messages = tokens.map((token) => ({
    to: token.token,
    sound: "default",
    title: event.title,
    body: event.body,
    channelId: ANDROID_CHANNELS[event.channel_id] ?? ANDROID_CHANNELS.system,
    priority: "high",
    ttl: notificationTtlSeconds(event.kind),
    ...(collapseId ? { collapseId } : {}),
    ...(notificationTag ? { tag: notificationTag } : {}),
    data: {
      ...event.payload,
      notificationId: event.id,
      kind: event.kind,
      routeKind: event.route_kind,
      routeId: event.route_id,
    },
  }));
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  const payload = await fetchExpoJsonWithRetry(EXPO_PUSH_URL, {
    fetch: fetchImpl,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify(messages),
    },
    maxResponseBytes: MAX_EXPO_RESPONSE_BYTES,
    sleep,
  });
  return normalizeExpoTickets(payload, messages.length);
}

async function processClaimedNotification(
  admin: SupabaseClient,
  claimed: ClaimedNotification,
  accessToken: string | null,
  fetchImpl: typeof fetch,
  sleep: (delayMs: number) => Promise<void>,
): Promise<DeliveryResult> {
  let pendingTokens = claimed.tokens;
  if (pendingTokens.length === 0) {
    return {
      eventId: claimed.event.id,
      delivered: 0,
      failed: 0,
      skipped: true,
    };
  }

  const invalidTokenIds: string[] = [];
  let successCount = 0;
  let retryableTicketFailureCount = 0;
  let permanentTicketFailureCount = 0;

  try {
    const { data: completedDeliveries, error: completedError } = await admin
      .from("notification_deliveries")
      .select("push_token_id")
      .eq("notification_event_id", claimed.event.id)
      .eq("status", "sent")
      .in("push_token_id", pendingTokens.map((token) => token.id));
    if (completedError) {
      throw new PersistenceError("Completed deliveries could not be read.");
    }

    const completedTokenIds = new Set(
      (completedDeliveries ?? []).map((delivery) => delivery.push_token_id),
    );
    pendingTokens = pendingTokens.filter((token) =>
      !completedTokenIds.has(token.id)
    );
    if (pendingTokens.length === 0) {
      const { error: eventError } = await admin.from("notification_events")
        .update({
          delivery_status: "sent",
          delivered_at: new Date().toISOString(),
          processing_started_at: null,
          last_error_code: null,
        }).eq("id", claimed.event.id);
      if (eventError) {
        throw new PersistenceError("Completed event state could not be saved.");
      }
      return {
        eventId: claimed.event.id,
        delivered: 0,
        failed: 0,
        skipped: true,
      };
    }

    for (const tokenBatch of chunks(pendingTokens, MAX_MESSAGES_PER_REQUEST)) {
      const deliveryBatch: Array<Record<string, unknown>> = [];
      const invalidTokenBatchIds: string[] = [];
      let tickets: ExpoTicket[];
      try {
        tickets = await sendExpoBatch(
          claimed.event,
          tokenBatch,
          accessToken,
          fetchImpl,
          sleep,
        );
      } catch (error) {
        const retryable = error instanceof ExpoHttpError &&
          (error.status === null || isTransientExpoStatus(error.status));
        throw new DeliveryProviderError(retryable);
      }
      tokenBatch.forEach((token, index) => {
        const ticket = tickets[index];
        const succeeded = ticket?.status === "ok";
        const errorCode = succeeded
          ? null
          : ticket?.details?.error ?? "EXPO_PUSH_ERROR";
        if (succeeded) successCount += 1;
        if (errorCode === "DeviceNotRegistered") {
          invalidTokenIds.push(token.id);
          invalidTokenBatchIds.push(token.id);
        } else if (
          !succeeded && typeof errorCode === "string" &&
          RETRYABLE_EXPO_TICKET_ERRORS.has(errorCode)
        ) {
          retryableTicketFailureCount += 1;
        } else if (!succeeded) {
          permanentTicketFailureCount += 1;
        }
        deliveryBatch.push({
          notification_event_id: claimed.event.id,
          push_token_id: token.id,
          status: succeeded ? "sent" : "failed",
          expo_ticket_id: ticket?.id ?? null,
          error_code: errorCode,
          error_message: ticket?.message?.slice(0, 500) ?? null,
          receipt_status: succeeded ? "pending" : null,
          receipt_attempt_count: 0,
          receipt_next_attempt_at: succeeded
            ? new Date(Date.now() + 15 * 60_000).toISOString()
            : null,
          receipt_checked_at: null,
          receipt_error_code: null,
        });
      });

      const { error: deliveryError } = await admin
        .from("notification_deliveries")
        .upsert(deliveryBatch, {
          onConflict: "notification_event_id,push_token_id",
        });
      if (deliveryError) {
        throw new PersistenceError("Delivery tickets could not be saved.");
      }

      if (invalidTokenBatchIds.length > 0) {
        const { error: tokenError } = await admin
          .from("push_tokens")
          .update({ disabled_at: new Date().toISOString() })
          .in("id", invalidTokenBatchIds);
        if (tokenError) {
          throw new PersistenceError("Invalid tokens could not be disabled.");
        }
      }
    }

    const retryableFailureCount = retryableTicketFailureCount;
    const permanentFailure = successCount === 0 &&
      invalidTokenIds.length + permanentTicketFailureCount ===
        pendingTokens.length;
    const nextStatus = retryableFailureCount > 0
      ? "failed"
      : successCount > 0
      ? "sent"
      : permanentFailure
      ? "cancelled"
      : "failed";
    const { error: eventError } = await admin
      .from("notification_events")
      .update({
        delivery_status: nextStatus,
        delivered_at: successCount > 0 ? new Date().toISOString() : null,
        processing_started_at: null,
        last_error_code: nextStatus === "sent"
          ? null
          : permanentFailure
          ? "DEVICE_NOT_REGISTERED"
          : successCount > 0
          ? "PARTIAL_EXPO_PUSH_ERROR"
          : "EXPO_PUSH_ERROR",
        next_attempt_at: nextStatus === "failed"
          ? new Date(
            Date.now() +
              60_000 * 2 ** Math.min(claimed.event.attempt_count, 6),
          ).toISOString()
          : new Date().toISOString(),
      })
      .eq("id", claimed.event.id);
    if (eventError) {
      throw new PersistenceError("Event delivery state could not be saved.");
    }

    return {
      eventId: claimed.event.id,
      delivered: successCount,
      failed: pendingTokens.length - successCount,
    };
  } catch (error) {
    const providerError = error instanceof DeliveryProviderError ? error : null;
    const isPersistenceFailure = providerError === null;
    const message = error instanceof Error ? error.message : String(error);
    const failureStatus = providerError && !providerError.retryable
      ? "cancelled"
      : "failed";
    const { error: persistenceError } = await admin
      .from("notification_events")
      .update({
        delivery_status: failureStatus,
        processing_started_at: null,
        last_error_code: message.slice(0, 120),
        next_attempt_at: failureStatus === "failed"
          ? new Date(
            Date.now() +
              60_000 * 2 ** Math.min(claimed.event.attempt_count, 6),
          ).toISOString()
          : new Date().toISOString(),
      })
      .eq("id", claimed.event.id);
    if (persistenceError) {
      throw new PersistenceError(
        "Notification failure state could not be persisted.",
      );
    }
    if (isPersistenceFailure) throw error;
    return {
      eventId: claimed.event.id,
      delivered: 0,
      failed: pendingTokens.length,
    };
  }
}

export async function handlePushDispatch(
  request: Request,
  dependencies: PushDispatchDependencies = {},
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
  const command = parseDispatchCommand(requestBody);
  if (!command) {
    return jsonResponse(400, { error: "Geçersiz worker komutu." });
  }

  const workerAuthorization = await authorizeWorkerRequest(
    request,
    workerSecret,
    "push-dispatch",
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
  let claimedNotifications: ClaimedNotification[] = [];
  if (command.kind === "event") {
    const { data, error } = await admin.rpc("claim_notification_event", {
      target_event_id: command.eventId,
    });
    if (error) {
      return jsonResponse(500, { error: "Bildirim olayı alınamadı." });
    }
    if (data) claimedNotifications = [data as ClaimedNotification];
  } else {
    const { data, error } = await admin.rpc("claim_notification_events", {
      requested_batch_size: command.batchSize,
    });
    if (error) {
      return jsonResponse(500, { error: "Bildirim kuyruğu alınamadı." });
    }
    claimedNotifications = Array.isArray(data)
      ? data as ClaimedNotification[]
      : [];
  }

  if (claimedNotifications.length === 0) {
    return jsonResponse(command.kind === "event" ? 202 : 200, {
      skipped: command.kind === "event",
      drained: command.kind === "drain",
      claimed: 0,
    });
  }

  let results: DeliveryResult[];
  try {
    results = await mapWithConcurrency(
      claimedNotifications,
      MAX_CONCURRENT_EVENTS,
      (claimed) =>
        processClaimedNotification(
          admin,
          claimed,
          getEnv("EXPO_ACCESS_TOKEN") ?? null,
          fetchImpl,
          sleep,
        ),
    );
  } catch {
    return jsonResponse(500, {
      error: "Bildirim teslimat durumu kalıcılaştırılamadı.",
    });
  }
  return jsonResponse(200, {
    claimed: results.length,
    delivered: results.reduce((sum, item) => sum + item.delivered, 0),
    failed: results.reduce((sum, item) => sum + item.failed, 0),
    results,
  });
}

if (import.meta.main) Deno.serve((request) => handlePushDispatch(request));

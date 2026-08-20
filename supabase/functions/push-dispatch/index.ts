import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.1";
import { isAuthorizedWorker } from "../_shared/workerAuth.ts";

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
const ANDROID_CHANNELS: Record<string, string> = {
  messages: "messages-v2",
  rooms: "rooms-v2",
  matches: "matches-v2",
  events: "events-v2",
  system: "system-v2",
};

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

function getEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as {
    eventId?: unknown;
    record?: { id?: unknown };
  };
  const eventId = value.eventId ?? value.record?.id;
  return typeof eventId === "string" ? eventId : null;
}

function getBatchSize(payload: unknown): number {
  if (!payload || typeof payload !== "object") return DEFAULT_BATCH_SIZE;
  const requested = Number((payload as { batchSize?: unknown }).batchSize);
  if (!Number.isInteger(requested)) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(requested, 1), MAX_BATCH_SIZE);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as {
        data?: ExpoTicket | ExpoTicket[];
        errors?: Array<{ message?: string }>;
      };
      if (!response.ok || !body.data) {
        const message = body.errors?.[0]?.message ??
          `Expo HTTP ${response.status}`;
        throw new Error(message);
      }
      return Array.isArray(body.data) ? body.data : [body.data];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await sleep(300 * 2 ** attempt + Math.random() * 150);
      }
    }
  }
  throw lastError ?? new Error("Expo Push Service yanıt vermedi.");
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

  const deliveries: Array<Record<string, unknown>> = [];
  const invalidTokenIds: string[] = [];
  let successCount = 0;

  try {
    const { data: completedDeliveries, error: completedError } = await admin
      .from("notification_deliveries")
      .select("push_token_id")
      .eq("notification_event_id", claimed.event.id)
      .eq("status", "sent")
      .in("push_token_id", pendingTokens.map((token) => token.id));
    if (completedError) throw completedError;

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
      if (eventError) throw eventError;
      return {
        eventId: claimed.event.id,
        delivered: 0,
        failed: 0,
        skipped: true,
      };
    }

    for (const tokenBatch of chunks(pendingTokens, MAX_MESSAGES_PER_REQUEST)) {
      const tickets = await sendExpoBatch(
        claimed.event,
        tokenBatch,
        accessToken,
        fetchImpl,
        sleep,
      );
      tokenBatch.forEach((token, index) => {
        const ticket = tickets[index];
        const succeeded = ticket?.status === "ok";
        const errorCode = succeeded
          ? null
          : ticket?.details?.error ?? "EXPO_PUSH_ERROR";
        if (succeeded) successCount += 1;
        if (errorCode === "DeviceNotRegistered") invalidTokenIds.push(token.id);
        deliveries.push({
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
    }

    const { error: deliveryError } = await admin
      .from("notification_deliveries")
      .upsert(deliveries, {
        onConflict: "notification_event_id,push_token_id",
      });
    if (deliveryError) throw deliveryError;

    if (invalidTokenIds.length > 0) {
      const { error: tokenError } = await admin
        .from("push_tokens")
        .update({ disabled_at: new Date().toISOString() })
        .in("id", invalidTokenIds);
      if (tokenError) throw tokenError;
    }

    const retryableFailureCount = pendingTokens.length - successCount -
      invalidTokenIds.length;
    const permanentFailure = successCount === 0 &&
      invalidTokenIds.length === pendingTokens.length;
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
    if (eventError) throw eventError;

    return {
      eventId: claimed.event.id,
      delivered: successCount,
      failed: pendingTokens.length - successCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("notification_events")
      .update({
        delivery_status: "failed",
        processing_started_at: null,
        last_error_code: message.slice(0, 120),
        next_attempt_at: new Date(
          Date.now() +
            60_000 * 2 ** Math.min(claimed.event.attempt_count, 6),
        ).toISOString(),
      })
      .eq("id", claimed.event.id);
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
  if (!isAuthorizedWorker(request, workerSecret)) {
    return jsonResponse(401, { error: "Yetkisiz worker çağrısı." });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    return jsonResponse(413, { error: "İstek gövdesi çok büyük." });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse(400, { error: "Geçersiz JSON gövdesi." });
  }

  const admin = createAdmin(supabaseUrl, serviceRoleKey);
  const eventId = getEventId(requestBody);
  const shouldDrain = requestBody !== null &&
    typeof requestBody === "object" &&
    (requestBody as { drain?: unknown }).drain === true;

  let claimedNotifications: ClaimedNotification[] = [];
  if (eventId) {
    const { data, error } = await admin.rpc("claim_notification_event", {
      target_event_id: eventId,
    });
    if (error) {
      return jsonResponse(500, { error: "Bildirim olayı alınamadı." });
    }
    if (data) claimedNotifications = [data as ClaimedNotification];
  } else if (shouldDrain) {
    const { data, error } = await admin.rpc("claim_notification_events", {
      requested_batch_size: getBatchSize(requestBody),
    });
    if (error) {
      return jsonResponse(500, { error: "Bildirim kuyruğu alınamadı." });
    }
    claimedNotifications = Array.isArray(data)
      ? data as ClaimedNotification[]
      : [];
  } else {
    return jsonResponse(400, { error: "Bildirim olay kimliği eksik." });
  }

  if (claimedNotifications.length === 0) {
    return jsonResponse(eventId ? 202 : 200, {
      skipped: Boolean(eventId),
      drained: shouldDrain,
      claimed: 0,
    });
  }

  const results = await mapWithConcurrency(
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
  return jsonResponse(200, {
    claimed: results.length,
    delivered: results.reduce((sum, item) => sum + item.delivered, 0),
    failed: results.reduce((sum, item) => sum + item.failed, 0),
    results,
  });
}

if (import.meta.main) Deno.serve((request) => handlePushDispatch(request));

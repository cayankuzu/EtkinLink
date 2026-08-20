import { handlePushDispatch } from "./index.ts";

const workerSecret = "worker-secret-12345678901234567890";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

function env(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: "https://staging.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    PUSH_WORKER_SECRET: workerSecret,
    ...overrides,
  };
  return (name: string) => values[name];
}

function request(
  body: unknown,
  secret = workerSecret,
  extraHeaders: Record<string, string> = {},
) {
  return new Request("https://worker.test/push-dispatch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-push-worker-secret": secret,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function claimedNotification(tokens = [
  { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  { id: "token-2", token: "ExpoPushToken[token-two]", platform: "ios" },
]) {
  return {
    event: {
      id: "event-1",
      user_id: "user-1",
      kind: "direct_message",
      route_kind: "match",
      route_id: "match-1",
      title: "Deniz",
      body: "Merhaba",
      payload: { collapseId: "chat-1", notificationTag: "match-1" },
      channel_id: "messages",
      attempt_count: 1,
    },
    tokens,
  };
}

function createAdmin(claim: unknown, completedTokenIds: string[] = []) {
  const writes = {
    deliveries: [] as Array<Record<string, unknown>>,
    disabledTokenIds: [] as string[],
    eventUpdates: [] as Array<Record<string, unknown>>,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.rpcCalls.push([name, args]);
      return { data: claim, error: null };
    },
    from: (table: string) => {
      if (table === "notification_deliveries") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({
                  data: completedTokenIds.map((push_token_id) => ({
                    push_token_id,
                  })),
                  error: null,
                }),
              }),
            }),
          }),
          upsert: async (rows: Array<Record<string, unknown>>) => {
            writes.deliveries.push(...rows);
            return { error: null };
          },
        };
      }
      if (table === "push_tokens") {
        return {
          update: (_values: Record<string, unknown>) => ({
            in: async (_column: string, ids: string[]) => {
              writes.disabledTokenIds.push(...ids);
              return { error: null };
            },
          }),
        };
      }
      return {
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            writes.eventUpdates.push(values);
            return { error: null };
          },
        }),
      };
    },
  };
  return { admin, writes };
}

Deno.test("dispatch yalnızca POST ve tam worker secret kabul eder", async () => {
  const get = await handlePushDispatch(
    new Request("https://worker.test", { method: "GET" }),
  );
  assertEquals(get.status, 405, "GET status");

  const unauthorized = await handlePushDispatch(
    request({ eventId: "x" }, "wrong"),
    {
      getEnv: env(),
    },
  );
  assertEquals(unauthorized.status, 401, "wrong secret status");

  const missingConfig = await handlePushDispatch(request({ eventId: "x" }), {
    getEnv: env({ SUPABASE_SERVICE_ROLE_KEY: undefined }),
  });
  assertEquals(missingConfig.status, 500, "missing config status");
});

Deno.test("dispatch büyük, bozuk ve hedefsiz payload'ları claim öncesi reddeder", async () => {
  const oversized = await handlePushDispatch(
    request({ drain: true }, workerSecret, { "content-length": "40000" }),
    { getEnv: env() },
  );
  assertEquals(oversized.status, 413, "oversized body");

  const malformed = new Request("https://worker.test", {
    method: "POST",
    headers: {
      "x-push-worker-secret": workerSecret,
      "content-type": "application/json",
    },
    body: "{broken",
  });
  const invalidJson = await handlePushDispatch(malformed, { getEnv: env() });
  assertEquals(invalidJson.status, 400, "invalid json");

  const { admin } = createAdmin(null);
  const missingTarget = await handlePushDispatch(request({}), {
    getEnv: env(),
    createAdmin: () => admin as never,
  });
  assertEquals(missingTarget.status, 400, "missing event target");
});

Deno.test("duplicate event claim edilmezse idempotent skipped yanıtı döner", async () => {
  const { admin, writes } = createAdmin(null);
  const response = await handlePushDispatch(request({ eventId: "event-1" }), {
    getEnv: env(),
    createAdmin: () => admin as never,
  });
  assertEquals(response.status, 202, "duplicate status");
  assertEquals(await response.json(), {
    skipped: true,
    drained: false,
    claimed: 0,
  }, "duplicate body");
  assertEquals(writes.rpcCalls[0], [
    "claim_notification_event",
    { target_event_id: "event-1" },
  ], "single-event claim");
});

Deno.test("empty drain batch'i başarıyla no-op olur ve batch size 25'e sınırlanır", async () => {
  const { admin, writes } = createAdmin([]);
  const response = await handlePushDispatch(
    request({ drain: true, batchSize: 999 }),
    { getEnv: env(), createAdmin: () => admin as never },
  );
  assertEquals(response.status, 200, "empty drain status");
  assertEquals(writes.rpcCalls[0], [
    "claim_notification_events",
    { requested_batch_size: 25 },
  ], "bounded batch size");
  assertEquals(await response.json(), {
    skipped: false,
    drained: true,
    claimed: 0,
  }, "empty drain body");
});

Deno.test("partial Expo failure teslimatları ayırır ve geçersiz tokenı kapatır", async () => {
  const { admin, writes } = createAdmin(claimedNotification());
  let sentMessages: Array<Record<string, unknown>> = [];
  const fetchStub: typeof fetch = async (_input, init) => {
    sentMessages = JSON.parse(
      String((init as { body?: BodyInit | null } | undefined)?.body),
    );
    return new Response(
      JSON.stringify({
        data: [
          { status: "ok", id: "ticket-1" },
          {
            status: "error",
            message: "not registered",
            details: { error: "DeviceNotRegistered" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const response = await handlePushDispatch(request({ eventId: "event-1" }), {
    getEnv: env({ EXPO_ACCESS_TOKEN: "expo-access" }),
    createAdmin: () => admin as never,
    fetch: fetchStub,
    sleep: async () => undefined,
  });

  assertEquals(response.status, 200, "partial response status");
  const body = await response.json() as Record<string, unknown>;
  assertEquals(
    [body.claimed, body.delivered, body.failed],
    [1, 1, 1],
    "counts",
  );
  assertEquals(sentMessages.length, 2, "message count");
  assertEquals(sentMessages[0]?.priority, "high", "chat priority");
  assertEquals(sentMessages[0]?.channelId, "messages-v2", "channel version");
  assertEquals(sentMessages[0]?.ttl, 86400, "chat ttl");
  assertEquals(
    writes.deliveries.map((item) => item.status),
    ["sent", "failed"],
    "delivery rows",
  );
  assertEquals(writes.disabledTokenIds, ["token-2"], "invalid token cleanup");
  assertEquals(writes.eventUpdates[0]?.delivery_status, "sent", "event status");
  assert(writes.eventUpdates[0]?.delivered_at, "delivery timestamp");
});

Deno.test("multi-device partial failure retries only the failed device", async () => {
  const first = createAdmin(claimedNotification());
  const firstResponse = await handlePushDispatch(
    request({ eventId: "event-1" }),
    {
      getEnv: env(),
      createAdmin: () => first.admin as never,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [
              { status: "ok", id: "ticket-1" },
              { status: "error", details: { error: "MessageRateExceeded" } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      sleep: async () => undefined,
    },
  );

  assertEquals(firstResponse.status, 200, "partial retry response");
  assertEquals(
    first.writes.eventUpdates[0]?.delivery_status,
    "failed",
    "partial retry state",
  );
  assertEquals(
    first.writes.eventUpdates[0]?.last_error_code,
    "PARTIAL_EXPO_PUSH_ERROR",
    "partial retry code",
  );

  const retry = createAdmin(claimedNotification(), ["token-1"]);
  let retriedMessages: Array<Record<string, unknown>> = [];
  await handlePushDispatch(request({ eventId: "event-1" }), {
    getEnv: env(),
    createAdmin: () => retry.admin as never,
    fetch: async (_input, init) => {
      retriedMessages = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          data: [{ status: "ok", id: "ticket-2" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    sleep: async () => undefined,
  });

  assertEquals(retriedMessages.length, 1, "only failed device retried");
  assertEquals(
    retriedMessages[0]?.to,
    "ExpoPushToken[token-two]",
    "successful device skipped",
  );
});

Deno.test("Expo geçici hatasını üç kez dener ve event'i backoff için failed yapar", async () => {
  const { admin, writes } = createAdmin(claimedNotification([
    { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  ]));
  let attempts = 0;
  const delays: number[] = [];
  const response = await handlePushDispatch(request({ eventId: "event-1" }), {
    getEnv: env(),
    createAdmin: () => admin as never,
    fetch: async () => {
      attempts += 1;
      throw new Error("Expo unavailable");
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
  });

  assertEquals(response.status, 200, "retry response");
  assertEquals(attempts, 3, "retry attempts");
  assertEquals(delays.length, 2, "backoff waits");
  assertEquals(
    writes.eventUpdates[0]?.delivery_status,
    "failed",
    "failed state",
  );
  assert(writes.eventUpdates[0]?.next_attempt_at, "next attempt timestamp");
});

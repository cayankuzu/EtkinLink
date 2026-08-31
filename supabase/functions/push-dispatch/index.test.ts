import { handlePushDispatch } from "./index.ts";
import { createWorkerSignature } from "../_shared/workerAuth.ts";

const workerSecret = "worker-secret-12345678901234567890";
const notificationEventId = "10000000-0000-4000-8000-000000000001";

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

async function request(
  body: unknown,
  secret = workerSecret,
  extraHeaders: Record<string, string> = {},
): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const signature = await createWorkerSignature(
    secret,
    timestamp,
    nonce,
    "push-dispatch",
    rawBody,
  );
  return new Request("https://worker.test/push-dispatch", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-push-worker-timestamp": String(timestamp),
      "x-push-worker-nonce": nonce,
      "x-push-worker-signature": signature,
      ...extraHeaders,
    },
    body: rawBody,
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

function createAdmin(
  claim: unknown,
  completedTokenIds: string[] = [],
  eventUpdateFailure = false,
) {
  const writes = {
    deliveries: [] as Array<Record<string, unknown>>,
    disabledTokenIds: [] as string[],
    eventUpdates: [] as Array<Record<string, unknown>>,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.rpcCalls.push([name, args]);
      if (name === "consume_push_worker_nonce") {
        return { data: true, error: null };
      }
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
            return {
              error: eventUpdateFailure
                ? new Error("event update failed")
                : null,
            };
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
    await request({ eventId: notificationEventId }, "wrong"),
    {
      getEnv: env(),
    },
  );
  assertEquals(unauthorized.status, 401, "wrong secret status");

  const missingConfig = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env({ SUPABASE_SERVICE_ROLE_KEY: undefined }),
    },
  );
  assertEquals(missingConfig.status, 500, "missing config status");
});

Deno.test("dispatch atomik nonce tüketimi replay döndürürse isteği reddeder", async () => {
  const admin = {
    rpc: async (name: string) => ({
      data: name === "consume_push_worker_nonce" ? false : null,
      error: null,
    }),
  };
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    { getEnv: env(), createAdmin: () => admin as never },
  );
  assertEquals(response.status, 401, "replayed nonce status");
});

Deno.test("dispatch büyük, bozuk ve hedefsiz payload'ları claim öncesi reddeder", async () => {
  const oversized = await handlePushDispatch(
    await request({ drain: true }, workerSecret, { "content-length": "40000" }),
    { getEnv: env() },
  );
  assertEquals(oversized.status, 413, "oversized body");

  const streamedOversized = await handlePushDispatch(
    await request({ drain: true, padding: "x".repeat(40_000) }),
    { getEnv: env() },
  );
  assertEquals(streamedOversized.status, 413, "streamed oversized body");

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
  const missingTarget = await handlePushDispatch(await request({}), {
    getEnv: env(),
    createAdmin: () => admin as never,
  });
  assertEquals(missingTarget.status, 400, "missing event target");
});

Deno.test("dispatch yalnızca exact UUID-event veya bounded drain komutunu kabul eder", async () => {
  const invalidCommands: unknown[] = [
    { eventId: "event-1" },
    { eventId: notificationEventId, extra: true },
    { record: { id: notificationEventId } },
    { eventId: notificationEventId, drain: true },
    { drain: false },
    { drain: true, batchSize: 0 },
    { drain: true, batchSize: 26 },
    { drain: true, batchSize: 1.5 },
    { drain: true, batchSize: "2" },
    { drain: true, extra: true },
  ];
  for (const command of invalidCommands) {
    const response = await handlePushDispatch(await request(command), {
      getEnv: env(),
    });
    assertEquals(
      response.status,
      400,
      `invalid command ${JSON.stringify(command)}`,
    );
  }

  const { admin, writes } = createAdmin([]);
  const defaultBatch = await handlePushDispatch(
    await request({ drain: true }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
    },
  );
  assertEquals(defaultBatch.status, 200, "default batch command");
  assertEquals(writes.rpcCalls[1], [
    "claim_notification_events",
    { requested_batch_size: 20 },
  ], "default batch size");
});

Deno.test("duplicate event claim edilmezse idempotent skipped yanıtı döner", async () => {
  const { admin, writes } = createAdmin(null);
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
    },
  );
  assertEquals(response.status, 202, "duplicate status");
  assertEquals(await response.json(), {
    skipped: true,
    drained: false,
    claimed: 0,
  }, "duplicate body");
  assertEquals(writes.rpcCalls[1], [
    "claim_notification_event",
    { target_event_id: notificationEventId },
  ], "single-event claim");
});

Deno.test("empty drain batch'i başarıyla no-op olur ve geçerli batch size kullanır", async () => {
  const { admin, writes } = createAdmin([]);
  const response = await handlePushDispatch(
    await request({ drain: true, batchSize: 25 }),
    { getEnv: env(), createAdmin: () => admin as never },
  );
  assertEquals(response.status, 200, "empty drain status");
  assertEquals(writes.rpcCalls[1], [
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
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env({ EXPO_ACCESS_TOKEN: "expo-access" }),
      createAdmin: () => admin as never,
      fetch: fetchStub,
      sleep: async () => undefined,
    },
  );

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
    await request({ eventId: notificationEventId }),
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
  await handlePushDispatch(await request({ eventId: notificationEventId }), {
    getEnv: env(),
    createAdmin: () => retry.admin as never,
    fetch: async (_input, init) => {
      const body = init && "body" in init ? init.body : undefined;
      retriedMessages = JSON.parse(String(body));
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

Deno.test("later Expo chunk failure persists earlier tickets and retries only the unsaved chunk", async () => {
  const tokens = Array.from({ length: 101 }, (_, index) => ({
    id: `token-${index + 1}`,
    token: `ExpoPushToken[token-${index + 1}]`,
    platform: index % 2 === 0 ? "android" as const : "ios" as const,
  }));
  const first = createAdmin(claimedNotification(tokens));
  let expoCalls = 0;
  let firstChunkPersistedBeforeSecondSend = false;

  const firstResponse = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => first.admin as never,
      fetch: async (_input, init) => {
        expoCalls += 1;
        const body = init && "body" in init ? init.body : undefined;
        const messages = JSON.parse(String(body)) as Array<
          Record<string, unknown>
        >;
        if (expoCalls === 1) {
          assertEquals(messages.length, 100, "first Expo chunk size");
          return new Response(
            JSON.stringify({
              data: messages.map((_message, index) => ({
                ...(index === 99
                  ? {
                    status: "error",
                    message: "not registered",
                    details: { error: "DeviceNotRegistered" },
                  }
                  : { status: "ok", id: `ticket-${index + 1}` }),
              })),
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        firstChunkPersistedBeforeSecondSend =
          first.writes.deliveries.length === 100 &&
          first.writes.disabledTokenIds[0] === "token-100";
        throw new Error("later Expo chunk unavailable");
      },
      sleep: async () => undefined,
    },
  );

  assertEquals(firstResponse.status, 200, "provider failure is handled");
  assertEquals(expoCalls, 4, "later chunk exhausts three HTTP attempts");
  assert(
    firstChunkPersistedBeforeSecondSend,
    "first chunk and invalid-token cleanup are durable before the next send",
  );
  assertEquals(first.writes.deliveries.length, 100, "durable first chunk");
  assertEquals(
    first.writes.deliveries.filter((delivery) => delivery.status === "sent")
      .length,
    99,
    "first chunk delivery states",
  );
  assertEquals(
    first.writes.disabledTokenIds,
    ["token-100"],
    "first chunk invalid token cleanup",
  );
  assertEquals(
    first.writes.eventUpdates[0]?.delivery_status,
    "failed",
    "event remains retryable",
  );

  const completedTokenIds = tokens.slice(0, 99).map((token) => token.id);
  const retryTokens = tokens.filter((token) => token.id !== "token-100");
  const retry = createAdmin(
    claimedNotification(retryTokens),
    completedTokenIds,
  );
  let retriedMessages: Array<Record<string, unknown>> = [];
  const retryResponse = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => retry.admin as never,
      fetch: async (_input, init) => {
        const body = init && "body" in init ? init.body : undefined;
        retriedMessages = JSON.parse(String(body));
        return new Response(
          JSON.stringify({ data: [{ status: "ok", id: "ticket-101" }] }),
          { headers: { "content-type": "application/json" } },
        );
      },
      sleep: async () => undefined,
    },
  );

  assertEquals(retryResponse.status, 200, "retry succeeds");
  assertEquals(retriedMessages.length, 1, "only unsaved token is retried");
  assertEquals(
    retriedMessages[0]?.to,
    "ExpoPushToken[token-101]",
    "persisted tokens are not resent",
  );
  assertEquals(
    retry.writes.deliveries.map((delivery) => delivery.push_token_id),
    ["token-101"],
    "retry persists only the remaining delivery",
  );
});

Deno.test("Expo geçici hatasını üç kez dener ve event'i backoff için failed yapar", async () => {
  const { admin, writes } = createAdmin(claimedNotification([
    { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  ]));
  let attempts = 0;
  const delays: number[] = [];
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
      fetch: async () => {
        attempts += 1;
        throw new Error("Expo unavailable");
      },
      sleep: async (delay) => {
        delays.push(delay);
      },
    },
  );

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

Deno.test("Expo kalıcı 4xx yanıtını retry etmez", async () => {
  const { admin, writes } = createAdmin(claimedNotification([
    { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  ]));
  let attempts = 0;
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
      fetch: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ errors: [{ message: "bad" }] }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      },
      sleep: async () => undefined,
    },
  );
  assertEquals(response.status, 200, "delivery attempt handled");
  assertEquals(attempts, 1, "permanent response not retried");
  assertEquals(
    writes.eventUpdates[0]?.delivery_status,
    "cancelled",
    "terminal state",
  );
});

Deno.test("Expo permanent ticket hatasını durable retry kuyruğuna geri koymaz", async () => {
  const { admin, writes } = createAdmin(claimedNotification([
    { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  ]));
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [{
              status: "error",
              message: "too large",
              details: { error: "MessageTooBig" },
            }],
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      sleep: async () => undefined,
    },
  );
  assertEquals(response.status, 200, "permanent ticket handled");
  assertEquals(
    writes.eventUpdates[0]?.delivery_status,
    "cancelled",
    "permanent ticket terminal state",
  );
});

Deno.test("Expo eksik ticket ve büyük response protokol hatası olarak işlenir", async () => {
  for (
    const expoResponse of [
      new Response(JSON.stringify({ data: [] }), {
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          data: [{
            status: "ok",
            id: "ticket-1",
            details: { error: "UnexpectedError" },
          }],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
      new Response(JSON.stringify({ value: "x".repeat(600 * 1024) }), {
        headers: { "content-type": "application/json" },
      }),
    ]
  ) {
    const { admin, writes } = createAdmin(claimedNotification([
      { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
    ]));
    let attempts = 0;
    const response = await handlePushDispatch(
      await request({ eventId: notificationEventId }),
      {
        getEnv: env(),
        createAdmin: () => admin as never,
        fetch: async () => {
          attempts += 1;
          return expoResponse.clone();
        },
        sleep: async () => undefined,
      },
    );
    assertEquals(response.status, 200, "protocol failure handled");
    assertEquals(attempts, 1, "200 protocol failure not retried");
    assertEquals(
      writes.eventUpdates[0]?.delivery_status,
      "cancelled",
      "terminal state",
    );
  }
});

Deno.test("delivery chunk persistence failure fails closed", async () => {
  const base = createAdmin(claimedNotification([
    { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
  ]));
  const failingAdmin = {
    ...base.admin,
    from: (table: string) => {
      const relation = base.admin.from(table);
      if (table !== "notification_deliveries") return relation;
      return {
        ...relation,
        upsert: async () => ({ error: new Error("delivery write failed") }),
      };
    },
  };
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => failingAdmin as never,
      fetch: async () =>
        new Response(
          JSON.stringify({ data: [{ status: "ok", id: "ticket-1" }] }),
          { headers: { "content-type": "application/json" } },
        ),
      sleep: async () => undefined,
    },
  );

  assertEquals(response.status, 500, "delivery persistence failure status");
  assertEquals(
    base.writes.eventUpdates[0]?.delivery_status,
    "failed",
    "event is released for a safe retry",
  );
});

Deno.test("event persistence hatası başarılı HTTP sonucu olarak raporlanmaz", async () => {
  const { admin } = createAdmin(
    claimedNotification([
      { id: "token-1", token: "ExpoPushToken[token-one]", platform: "android" },
    ]),
    [],
    true,
  );
  const response = await handlePushDispatch(
    await request({ eventId: notificationEventId }),
    {
      getEnv: env(),
      createAdmin: () => admin as never,
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [{ status: "ok", id: "ticket-1" }],
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      sleep: async () => undefined,
    },
  );
  assertEquals(response.status, 500, "persistence failure status");
});

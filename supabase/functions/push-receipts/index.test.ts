import {
  classifyReceipt,
  handlePushReceipts,
  nextReceiptAttempt,
} from "./index.ts";

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

function request(secret = workerSecret) {
  return new Request("https://worker.test/push-receipts", {
    method: "POST",
    headers: { "x-push-worker-secret": secret },
  });
}

type Delivery = {
  id: string;
  expo_ticket_id: string;
  push_token_id: string;
  receipt_attempt_count: number | null;
};

function createAdmin(deliveries: Delivery[], failedUpdateId?: string) {
  const writes = {
    deliveryUpdates: [] as Array<{
      id: string;
      values: Record<string, unknown>;
    }>,
    disabledTokenIds: [] as string[],
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.rpcCalls.push([name, args]);
      return { data: deliveries, error: null };
    },
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          if (table === "notification_deliveries") {
            writes.deliveryUpdates.push({ id, values });
            return {
              error: id === failedUpdateId ? new Error("write failed") : null,
            };
          }
          writes.disabledTokenIds.push(id);
          return { error: null };
        },
      }),
    }),
  };
  return { admin, writes };
}

Deno.test("receipt sınıflandırma delivered, invalid, retryable ve permanent durumlarını ayırır", () => {
  assertEquals(classifyReceipt({ status: "ok" }), "delivered", "ok receipt");
  assertEquals(
    classifyReceipt({
      status: "error",
      details: { error: "DeviceNotRegistered" },
    }),
    "invalid_token",
    "invalid token",
  );
  assertEquals(
    classifyReceipt({
      status: "error",
      details: { error: "ServiceUnavailable" },
    }),
    "retryable",
    "retryable receipt",
  );
  assertEquals(
    classifyReceipt({
      status: "error",
      details: { error: "MessageTooBig" },
    }),
    "permanent_failure",
    "permanent receipt",
  );
});

Deno.test("receipt backoff 5 dakikadan başlar ve 60 dakikada tavan yapar", () => {
  const now = Date.now();
  const firstDelay = new Date(nextReceiptAttempt(1)).getTime() - now;
  const cappedDelay = new Date(nextReceiptAttempt(9)).getTime() - now;
  assert(
    firstDelay >= 5 * 60_000 && firstDelay < 5 * 60_000 + 100,
    "first delay",
  );
  assert(
    cappedDelay >= 60 * 60_000 && cappedDelay < 60 * 60_000 + 100,
    "capped delay",
  );
});

Deno.test("receipt worker method, config ve secret sınırlarını fail-closed uygular", async () => {
  const get = await handlePushReceipts(
    new Request("https://worker.test", { method: "GET" }),
  );
  assertEquals(get.status, 405, "GET status");
  const unauthorized = await handlePushReceipts(request("revoked-secret"), {
    getEnv: env(),
  });
  assertEquals(unauthorized.status, 401, "wrong secret");
  const missingConfig = await handlePushReceipts(request(), {
    getEnv: env({ SUPABASE_URL: undefined }),
  });
  assertEquals(missingConfig.status, 500, "missing config");
});

Deno.test("boş receipt claim Expo'ya gitmeden no-op tamamlanır", async () => {
  const { admin, writes } = createAdmin([]);
  let fetchCalled = false;
  const response = await handlePushReceipts(request(), {
    getEnv: env(),
    createAdmin: () => admin as never,
    fetch: async () => {
      fetchCalled = true;
      return new Response();
    },
  });
  assertEquals(response.status, 200, "empty status");
  assertEquals(await response.json(), { checked: 0 }, "empty body");
  assertEquals(fetchCalled, false, "Expo not called");
  assertEquals(writes.rpcCalls[0], [
    "claim_pending_push_receipts",
    { requested_batch_size: 300 },
  ], "receipt claim");
});

Deno.test("receipt batch success, retry, exhaustion ve invalid-token cleanup'ı birlikte işler", async () => {
  const deliveries: Delivery[] = [
    {
      id: "d1",
      expo_ticket_id: "t1",
      push_token_id: "p1",
      receipt_attempt_count: 0,
    },
    {
      id: "d2",
      expo_ticket_id: "t2",
      push_token_id: "p2",
      receipt_attempt_count: 0,
    },
    {
      id: "d3",
      expo_ticket_id: "t3",
      push_token_id: "p3",
      receipt_attempt_count: 0,
    },
    {
      id: "d4",
      expo_ticket_id: "t4",
      push_token_id: "p4",
      receipt_attempt_count: 2,
    },
    {
      id: "d5",
      expo_ticket_id: "t5",
      push_token_id: "p5",
      receipt_attempt_count: 4,
    },
  ];
  const { admin, writes } = createAdmin(deliveries);
  let requestedIds: string[] = [];
  const response = await handlePushReceipts(request(), {
    getEnv: env({ EXPO_ACCESS_TOKEN: "expo-access" }),
    createAdmin: () => admin as never,
    fetch: async (_input, init) => {
      requestedIds = JSON.parse(
        String((init as { body?: BodyInit | null } | undefined)?.body),
      ).ids;
      return new Response(
        JSON.stringify({
          data: {
            t1: { status: "ok" },
            t2: {
              status: "error",
              message: "gone",
              details: { error: "DeviceNotRegistered" },
            },
            t3: {
              status: "error",
              details: { error: "ServiceUnavailable" },
            },
            t4: {
              status: "error",
              details: { error: "MessageTooBig" },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assertEquals(response.status, 200, "receipt status");
  assertEquals(requestedIds, ["t1", "t2", "t3", "t4", "t5"], "ticket ids");
  assertEquals(await response.json(), {
    checked: 5,
    delivered: 1,
    retryable: 1,
    permanentFailure: 2,
    invalidToken: 1,
  }, "receipt counters");
  assertEquals(
    writes.deliveryUpdates.map((item) => item.values.receipt_status),
    [
      "delivered",
      "invalid_token",
      "retryable",
      "permanent_failure",
      "permanent_failure",
    ],
    "stored receipt states",
  );
  assertEquals(writes.disabledTokenIds, ["p2"], "invalid token disabled");
  const retry = writes.deliveryUpdates.find((item) => item.id === "d3")?.values;
  assert(retry?.receipt_next_attempt_at, "retry timestamp");
  const exhausted = writes.deliveryUpdates.find((item) => item.id === "d5")
    ?.values;
  assertEquals(
    exhausted?.receipt_next_attempt_at,
    null,
    "exhausted has no retry",
  );
});

Deno.test("Expo receipt ağ ve protokol hataları 502 döner; DB update hatası sayaçlara eklenmez", async () => {
  const delivery: Delivery = {
    id: "d1",
    expo_ticket_id: "t1",
    push_token_id: "p1",
    receipt_attempt_count: 0,
  };
  const networkAdmin = createAdmin([delivery]);
  const networkFailure = await handlePushReceipts(request(), {
    getEnv: env(),
    createAdmin: () => networkAdmin.admin as never,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assertEquals(networkFailure.status, 502, "network failure");

  const protocolAdmin = createAdmin([delivery]);
  const protocolFailure = await handlePushReceipts(request(), {
    getEnv: env(),
    createAdmin: () => protocolAdmin.admin as never,
    fetch: async () => new Response("{}", { status: 503 }),
  });
  assertEquals(protocolFailure.status, 502, "protocol failure");

  const updateAdmin = createAdmin([delivery], "d1");
  const skippedUpdate = await handlePushReceipts(request(), {
    getEnv: env(),
    createAdmin: () => updateAdmin.admin as never,
    fetch: async () =>
      new Response(JSON.stringify({ data: { t1: { status: "ok" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assertEquals(await skippedUpdate.json(), {
    checked: 0,
    delivered: 0,
    retryable: 0,
    permanentFailure: 0,
    invalidToken: 0,
  }, "failed DB update excluded");
});

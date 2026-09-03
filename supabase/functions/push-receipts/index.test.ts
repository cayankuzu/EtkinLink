import { classifyReceipt, handlePushReceipts } from "./index.ts";
import { createWorkerSignature } from "../_shared/workerAuth.ts";

const workerSecret = "worker-secret-12345678901234567890";

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
  secret = workerSecret,
  body: unknown = {},
): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const signature = await createWorkerSignature(
    secret,
    timestamp,
    nonce,
    "push-receipts",
    rawBody,
  );
  return new Request("https://worker.test/push-receipts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-push-worker-timestamp": String(timestamp),
      "x-push-worker-nonce": nonce,
      "x-push-worker-signature": signature,
    },
    body: rawBody,
  });
}

type Delivery = {
  id: string;
  expo_ticket_id: string;
  push_token_id: string;
  receipt_attempt_count: number | null;
  receipt_lease_id: string;
};

function createAdmin(
  deliveries: Delivery[],
  failedPersistId?: string,
) {
  const writes = {
    receiptPersists: [] as Array<Record<string, unknown>>,
    rpcCalls: [] as Array<[string, Record<string, unknown>]>,
  };
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.rpcCalls.push([name, args]);
      if (name === "consume_push_worker_nonce") {
        return { data: true, error: null };
      }
      if (name === "persist_push_receipt_result") {
        writes.receiptPersists.push(args);
        const failed = args.target_delivery_id === failedPersistId;
        return {
          data: failed ? false : true,
          error: failed ? new Error("atomic receipt write failed") : null,
        };
      }
      return { data: deliveries, error: null };
    },
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

Deno.test("receipt worker method, config ve secret sınırlarını fail-closed uygular", async () => {
  const get = await handlePushReceipts(
    new Request("https://worker.test", { method: "GET" }),
  );
  assertEquals(get.status, 405, "GET status");
  const unauthorized = await handlePushReceipts(
    await request("revoked-secret"),
    {
      getEnv: env(),
    },
  );
  assertEquals(unauthorized.status, 401, "wrong secret");
  const missingConfig = await handlePushReceipts(await request(), {
    getEnv: env({ SUPABASE_URL: undefined }),
  });
  assertEquals(missingConfig.status, 500, "missing config");
});

Deno.test("receipt worker replay nonce ve bozuk/büyük JSON gövdelerini reddeder", async () => {
  const replayAdmin = {
    rpc: async (name: string) => ({
      data: name === "consume_push_worker_nonce" ? false : [],
      error: null,
    }),
  };
  const replay = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => replayAdmin as never,
  });
  assertEquals(replay.status, 401, "replayed nonce");

  const malformed = await handlePushReceipts(
    new Request("https://worker.test/push-receipts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{broken",
    }),
    { getEnv: env() },
  );
  assertEquals(malformed.status, 400, "malformed body");

  const oversized = await handlePushReceipts(
    new Request("https://worker.test/push-receipts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "5000",
      },
      body: "{}",
    }),
    { getEnv: env() },
  );
  assertEquals(oversized.status, 413, "oversized body");

  const streamedOversized = await handlePushReceipts(
    await request(workerSecret, { padding: "x".repeat(5_000) }),
    { getEnv: env() },
  );
  assertEquals(streamedOversized.status, 413, "streamed oversized body");

  for (const command of [{ drain: true }, [], null, { batchSize: 20 }]) {
    const extraCommand = await handlePushReceipts(
      await request(workerSecret, command),
      { getEnv: env() },
    );
    assertEquals(
      extraCommand.status,
      400,
      `non-empty receipt command ${JSON.stringify(command)}`,
    );
  }
});

Deno.test("boş receipt claim Expo'ya gitmeden no-op tamamlanır", async () => {
  const { admin, writes } = createAdmin([]);
  let fetchCalled = false;
  const response = await handlePushReceipts(await request(), {
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
  assertEquals(writes.rpcCalls[1], [
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
      receipt_lease_id: "00000000-0000-4000-8000-000000000001",
    },
    {
      id: "d2",
      expo_ticket_id: "t2",
      push_token_id: "p2",
      receipt_attempt_count: 0,
      receipt_lease_id: "00000000-0000-4000-8000-000000000002",
    },
    {
      id: "d3",
      expo_ticket_id: "t3",
      push_token_id: "p3",
      receipt_attempt_count: 0,
      receipt_lease_id: "00000000-0000-4000-8000-000000000003",
    },
    {
      id: "d4",
      expo_ticket_id: "t4",
      push_token_id: "p4",
      receipt_attempt_count: 2,
      receipt_lease_id: "00000000-0000-4000-8000-000000000004",
    },
    {
      id: "d5",
      expo_ticket_id: "t5",
      push_token_id: "p5",
      receipt_attempt_count: 4,
      receipt_lease_id: "00000000-0000-4000-8000-000000000005",
    },
  ];
  const { admin, writes } = createAdmin(deliveries);
  let requestedIds: string[] = [];
  const response = await handlePushReceipts(await request(), {
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
    writes.receiptPersists.map((item) => item.result_status),
    [
      "delivered",
      "invalid_token",
      "retryable",
      "permanent_failure",
      "retryable",
    ],
    "stored receipt states",
  );
  assertEquals(writes.receiptPersists[1], {
    target_delivery_id: "d2",
    expected_receipt_attempt_count: 0,
    expected_receipt_lease_id: "00000000-0000-4000-8000-000000000002",
    result_status: "invalid_token",
    result_error_code: "DeviceNotRegistered",
    result_error_message: "gone",
  }, "invalid token and terminal receipt use one atomic RPC");
  const retry = writes.receiptPersists.find((item) =>
    item.target_delivery_id === "d3"
  );
  assertEquals(retry?.result_status, "retryable", "retry state");
  const exhausted = writes.receiptPersists.find((item) =>
    item.target_delivery_id === "d5"
  );
  assertEquals(
    exhausted?.result_status,
    "retryable",
    "DB owns the exhausted retryable-to-terminal transition",
  );
});

Deno.test("Expo receipt ağ ve protokol hataları 502 döner; DB update hatası sayaçlara eklenmez", async () => {
  const delivery: Delivery = {
    id: "d1",
    expo_ticket_id: "t1",
    push_token_id: "p1",
    receipt_attempt_count: 0,
    receipt_lease_id: "00000000-0000-4000-8000-000000000006",
  };
  const networkAdmin = createAdmin([delivery]);
  const networkFailure = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => networkAdmin.admin as never,
    fetch: async () => {
      throw new Error("offline");
    },
    sleep: async () => undefined,
  });
  assertEquals(networkFailure.status, 502, "network failure");
  assertEquals(
    networkAdmin.writes.receiptPersists[0]?.result_status,
    "retryable",
    "network failure consumes a durable bounded attempt",
  );
  assertEquals(
    networkAdmin.writes.receiptPersists[0]?.result_error_code,
    "EXPO_TRANSIENT_FAILURE",
    "network failure code",
  );

  const protocolAdmin = createAdmin([delivery]);
  const protocolFailure = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => protocolAdmin.admin as never,
    fetch: async () => new Response("{}", { status: 503 }),
    sleep: async () => undefined,
  });
  assertEquals(protocolFailure.status, 502, "protocol failure");
  assertEquals(
    protocolAdmin.writes.receiptPersists[0]?.result_status,
    "retryable",
    "transient HTTP failure consumes a durable bounded attempt",
  );

  const updateAdmin = createAdmin([delivery], "d1");
  const skippedUpdate = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => updateAdmin.admin as never,
    fetch: async () =>
      new Response(JSON.stringify({ data: { t1: { status: "ok" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  assertEquals(skippedUpdate.status, 500, "failed DB update status");
});

Deno.test("invalid token atomik RPC hatasında receipt terminale düşürülmez", async () => {
  const delivery: Delivery = {
    id: "d-invalid",
    expo_ticket_id: "t-invalid",
    push_token_id: "p-invalid",
    receipt_attempt_count: 1,
    receipt_lease_id: "00000000-0000-4000-8000-000000000007",
  };
  const { admin, writes } = createAdmin(
    [delivery],
    delivery.id,
  );
  const response = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => admin as never,
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: {
            "t-invalid": {
              status: "error",
              details: { error: "DeviceNotRegistered" },
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  assertEquals(response.status, 500, "atomic RPC failure status");
  assertEquals(writes.receiptPersists.length, 1, "atomic RPC attempted");
});

Deno.test("receipt worker permanent Expo 4xx'i retry etmez", async () => {
  const delivery: Delivery = {
    id: "d1",
    expo_ticket_id: "t1",
    push_token_id: "p1",
    receipt_attempt_count: 0,
    receipt_lease_id: "00000000-0000-4000-8000-000000000008",
  };
  const { admin, writes } = createAdmin([delivery]);
  let attempts = 0;
  const response = await handlePushReceipts(await request(), {
    getEnv: env(),
    createAdmin: () => admin as never,
    fetch: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
    sleep: async () => undefined,
  });
  assertEquals(response.status, 502, "permanent Expo status");
  assertEquals(attempts, 1, "permanent Expo response not retried");
  assertEquals(
    writes.receiptPersists[0]?.result_status,
    "permanent_failure",
    "permanent HTTP failure terminally persisted",
  );
});

Deno.test("receipt worker malformed ve büyük Expo 2xx response'larını bounded retryable yapar", async () => {
  const delivery: Delivery = {
    id: "d1",
    expo_ticket_id: "t1",
    push_token_id: "p1",
    receipt_attempt_count: 0,
    receipt_lease_id: "00000000-0000-4000-8000-000000000009",
  };
  for (
    const expoResponse of [
      new Response(JSON.stringify({ data: { t1: { status: "unknown" } } }), {
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          data: {
            t1: {
              status: "ok",
              details: { error: "UnexpectedError" },
            },
          },
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
    const { admin, writes } = createAdmin([delivery]);
    let attempts = 0;
    const response = await handlePushReceipts(await request(), {
      getEnv: env(),
      createAdmin: () => admin as never,
      fetch: async () => {
        attempts += 1;
        return expoResponse.clone();
      },
      sleep: async () => undefined,
    });
    assertEquals(response.status, 502, "invalid protocol status");
    assertEquals(attempts, 1, "200 protocol error not immediately retried");
    assertEquals(
      writes.receiptPersists[0]?.result_status,
      "retryable",
      "protocol failure consumes a bounded durable retry",
    );
    assertEquals(
      writes.receiptPersists[0]?.result_error_code,
      "EXPO_PROTOCOL_ERROR",
      "protocol failure uses stable retry code",
    );
  }
});

import {
  authorizeWorkerRequest,
  constantTimeEqual,
  createWorkerSignature,
  MAX_WORKER_CLOCK_SKEW_SECONDS,
} from "./workerAuth.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const secret = "a".repeat(32);
const scope = "push-dispatch";
const body = '{"drain":true}';

async function signedRequest(
  overrides: {
    timestamp?: number;
    nonce?: string;
    signingSecret?: string;
    signature?: string;
    body?: string;
  } = {},
): Promise<Request> {
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce ?? crypto.randomUUID();
  const rawBody = overrides.body ?? body;
  const signature = overrides.signature ?? await createWorkerSignature(
    overrides.signingSecret ?? secret,
    timestamp,
    nonce,
    scope,
    rawBody,
  );
  return new Request("https://worker.test", {
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

Deno.test("constantTimeEqual compares both value and length", () => {
  assert(constantTimeEqual("same-secret", "same-secret"), "same secret");
  assert(!constantTimeEqual("same-secret", "same-secret-extra"), "length");
  assert(!constantTimeEqual("same-secret", "same-secreu"), "content");
});

Deno.test("worker HMAC accepts a fresh scoped request", async () => {
  const request = await signedRequest();
  const authorization = await authorizeWorkerRequest(
    request,
    secret,
    scope,
    body,
  );
  assert(authorization, "fresh signature");
  assert(authorization.scope === scope, "scope");
});

Deno.test("worker HMAC rejects wrong secret, body tampering, and cross-scope reuse", async () => {
  const wrongSecret = await authorizeWorkerRequest(
    await signedRequest({ signingSecret: "b".repeat(32) }),
    secret,
    scope,
    body,
  );
  assert(!wrongSecret, "wrong secret");

  const signed = await signedRequest();
  const tampered = await authorizeWorkerRequest(
    signed,
    secret,
    scope,
    '{"drain":false}',
  );
  assert(!tampered, "tampered body");

  const crossScope = await authorizeWorkerRequest(
    await signedRequest(),
    secret,
    "push-receipts",
    body,
  );
  assert(!crossScope, "cross-scope signature");
});

Deno.test("worker HMAC rejects stale/future timestamps and malformed nonce/signature", async () => {
  const nowMs = Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  for (
    const timestamp of [
      nowSeconds - MAX_WORKER_CLOCK_SKEW_SECONDS - 1,
      nowSeconds + MAX_WORKER_CLOCK_SKEW_SECONDS + 1,
    ]
  ) {
    const authorization = await authorizeWorkerRequest(
      await signedRequest({ timestamp }),
      secret,
      scope,
      body,
      nowMs,
    );
    assert(!authorization, "out-of-window timestamp");
  }

  const malformedNonce = await authorizeWorkerRequest(
    await signedRequest({ nonce: "not-a-uuid" }),
    secret,
    scope,
    body,
    nowMs,
  );
  assert(!malformedNonce, "malformed nonce");

  const malformedSignature = await authorizeWorkerRequest(
    await signedRequest({ signature: "v1=not-hex" }),
    secret,
    scope,
    body,
    nowMs,
  );
  assert(!malformedSignature, "malformed signature");
});

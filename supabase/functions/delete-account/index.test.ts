import {
  type FetchLike,
  MAX_POSTGREST_RESPONSE_BYTES,
  POSTGREST_VERIFY_TIMEOUT_MS,
  verifyTokenThroughPostgrest,
} from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

async function assertRejects(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error("expected operation to reject");
}

function jsonResponse(body: string, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

Deno.test("PostgREST verification uses a bounded same-origin HTTPS request", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  let timeoutMilliseconds = 0;
  const controller = new AbortController();
  const fetcher: FetchLike = (input, init) => {
    requestedUrl = input.toString();
    requestedInit = init;
    return Promise.resolve(
      jsonResponse(
        JSON.stringify([{ user_id: USER_ID, issued_at: "1788091170" }]),
      ),
    );
  };

  const claims = await verifyTokenThroughPostgrest(
    "https://project.supabase.co/",
    "anon-key",
    "signed-user-token",
    {
      fetcher,
      timeoutSignal(milliseconds) {
        timeoutMilliseconds = milliseconds;
        return controller.signal;
      },
    },
  );

  assertEquals(claims, { sub: USER_ID, iat: 1788091170 });
  assertEquals(
    requestedUrl,
    "https://project.supabase.co/rest/v1/rpc/get_verified_account_deletion_claims",
  );
  assertEquals(requestedInit?.method, "POST");
  assertEquals(requestedInit?.redirect, "error");
  assert(requestedInit?.signal === controller.signal);
  assertEquals(timeoutMilliseconds, POSTGREST_VERIFY_TIMEOUT_MS);
  const headers = new Headers(requestedInit?.headers);
  assertEquals(headers.get("authorization"), "Bearer signed-user-token");
  assertEquals(headers.get("apikey"), "anon-key");
});

Deno.test("PostgREST verification rejects untrusted base URLs before fetch", async () => {
  let fetchCalls = 0;
  const fetcher: FetchLike = () => {
    fetchCalls += 1;
    return Promise.resolve(jsonResponse("[]"));
  };

  for (
    const url of [
      "http://project.supabase.co/",
      "https://user:password@project.supabase.co/",
      "https://project.supabase.co/untrusted-path",
      "https://project.supabase.co/?redirect=https://evil.test",
    ]
  ) {
    await assertRejects(() =>
      verifyTokenThroughPostgrest(url, "anon-key", "token", { fetcher })
    );
  }
  assertEquals(fetchCalls, 0);
});

Deno.test("PostgREST verification rejects redirects and cross-origin responses", async () => {
  const redirected = jsonResponse("[]");
  Object.defineProperty(redirected, "redirected", { value: true });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(redirected) },
    )
  );

  const crossOrigin = jsonResponse("[]");
  Object.defineProperty(crossOrigin, "url", {
    value: "https://evil.test/result",
  });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(crossOrigin) },
    )
  );
});

Deno.test("PostgREST verification requires JSON and a valid claims shape", async () => {
  const html = new Response("<html></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(html) },
    )
  );

  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      {
        fetcher: () =>
          Promise.resolve(
            jsonResponse(
              JSON.stringify([{ user_id: USER_ID, issued_at: 1.5 }]),
            ),
          ),
      },
    )
  );
});

Deno.test("PostgREST verification enforces declared and streamed byte limits", async () => {
  const declaredOversize = jsonResponse("[]", {
    "content-length": String(MAX_POSTGREST_RESPONSE_BYTES + 1),
  });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(declaredOversize) },
    )
  );

  let streamCancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new Uint8Array(MAX_POSTGREST_RESPONSE_BYTES + 1).fill(0x20),
      );
    },
    cancel() {
      streamCancelled = true;
    },
  });
  const streamedOversize = new Response(stream, {
    status: 200,
    headers: { "content-type": "application/problem+json" },
  });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(streamedOversize) },
    )
  );
  assert(streamCancelled, "oversized response stream should be cancelled");
});

Deno.test("PostgREST verification rejects malformed UTF-8", async () => {
  const malformed = new Response(new Uint8Array([0xff]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  await assertRejects(() =>
    verifyTokenThroughPostgrest(
      "https://project.supabase.co/",
      "anon-key",
      "token",
      { fetcher: () => Promise.resolve(malformed) },
    )
  );
});

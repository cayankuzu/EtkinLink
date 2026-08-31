import {
  ExpoHttpError,
  fetchExpoJsonWithRetry,
  isTransientExpoStatus,
  parseRetryAfterMs,
} from "./expoHttp.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("Expo retry classification is limited to 408, 429, and 5xx", () => {
  assert(isTransientExpoStatus(408), "408");
  assert(isTransientExpoStatus(429), "429");
  assert(isTransientExpoStatus(503), "503");
  assert(!isTransientExpoStatus(400), "400");
  assert(!isTransientExpoStatus(401), "401");
});

Deno.test("Retry-After seconds and dates are parsed with a ten-second cap", () => {
  const now = Date.UTC(2026, 7, 30, 12, 0, 0);
  assert(parseRetryAfterMs("2", now) === 2_000, "seconds");
  assert(
    parseRetryAfterMs(new Date(now + 30_000).toUTCString(), now) === 10_000,
    "date cap",
  );
  assert(parseRetryAfterMs("invalid", now) === null, "invalid");
});

Deno.test("Expo fetch honors Retry-After then succeeds", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const payload = await fetchExpoJsonWithRetry("https://expo.test", {
    fetch: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(JSON.stringify({ error: "busy" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "2",
          },
        })
        : new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
        });
    },
    init: { method: "POST" },
    maxResponseBytes: 1_024,
    sleep: async (delay) => {
      delays.push(delay);
    },
    random: () => 0,
  });
  assert(attempts === 2, "attempt count");
  assert(delays[0] === 2_000, "Retry-After delay");
  assert(Array.isArray((payload as { data?: unknown }).data), "payload");
});

Deno.test("Expo fetch never retries a permanent 4xx", async () => {
  let attempts = 0;
  try {
    await fetchExpoJsonWithRetry("https://expo.test", {
      fetch: async () => {
        attempts += 1;
        return new Response(JSON.stringify({ error: "invalid" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      },
      init: { method: "POST" },
      maxResponseBytes: 1_024,
      sleep: async () => undefined,
    });
    throw new Error("Expected permanent Expo failure.");
  } catch (error) {
    assert(error instanceof ExpoHttpError, "error type");
    assert(error.status === 400, "status");
  }
  assert(attempts === 1, "single attempt");
});

Deno.test("Expo fetch retries a network failure at most three times", async () => {
  let attempts = 0;
  const delays: number[] = [];
  try {
    await fetchExpoJsonWithRetry("https://expo.test", {
      fetch: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      init: { method: "POST" },
      maxResponseBytes: 1_024,
      sleep: async (delay) => {
        delays.push(delay);
      },
      random: () => 0,
    });
    throw new Error("Expected network failure.");
  } catch (error) {
    assert(error instanceof ExpoHttpError, "error type");
    assert(error.status === null, "network status");
  }
  assert(attempts === 3, "bounded attempts");
  assert(delays.length === 2, "bounded sleeps");
});

Deno.test("Expo fetch forces redirect rejection and bounds it as a network failure", async () => {
  let attempts = 0;
  const redirectModes: Array<RequestRedirect | undefined> = [];
  try {
    await fetchExpoJsonWithRetry("https://expo.test", {
      fetch: (async (_input, init) => {
        attempts += 1;
        redirectModes.push(
          (init as { redirect?: RequestRedirect } | undefined)?.redirect,
        );
        throw new TypeError("redirect disallowed");
      }) as typeof fetch,
      init: { method: "POST", redirect: "follow" },
      maxResponseBytes: 1_024,
      sleep: async () => undefined,
      random: () => 0,
    });
    throw new Error("Expected rejected redirect failure.");
  } catch (error) {
    assert(error instanceof ExpoHttpError, "error type");
    assert(error.status === null, "redirect is fail-closed as network error");
  }
  assert(attempts === 3, "redirect failure retry bound");
  assert(
    redirectModes.every((mode) => mode === "error"),
    "caller cannot enable redirects",
  );
});

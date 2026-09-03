import assert from "node:assert/strict";

import {
  EVENTS_API_URL,
  fetchBoundedJson,
  UpstreamHttpError,
} from "../../../supabase/functions/ingest-events/upstreamHttp.ts";

const baseUrl = process.env.MOCK_BASE_URL;
if (!baseUrl || !baseUrl.startsWith("http://upstream-mock:")) {
  throw new Error("MOCK_BASE_URL must target the isolated Compose mock");
}

async function expectUpstreamCode(action, expectedCode) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof UpstreamHttpError);
    assert.equal(error.message, expectedCode);
    return true;
  });
}

function createInjectedMockFetch(scenario, observations = []) {
  return async (input, init = {}) => {
    const productionUrl = new URL(input.toString());
    assert.equal(productionUrl.origin, "https://etkinlik.io");
    assert.equal(productionUrl.pathname, "/api/v2/events");
    assert.equal(init.method?.toUpperCase() ?? "GET", "GET");
    assert.equal(init.body ?? null, null);
    assert.equal(init.redirect, "manual");

    observations.push({
      productionUrl: productionUrl.toString(),
      redirect: init.redirect,
    });

    const mockUrl = new URL("/api/v2/events", baseUrl);
    mockUrl.search = productionUrl.search;
    const headers = new Headers(init.headers);
    if (scenario) headers.set("x-mock-scenario", scenario);

    // The application transport validates the production URL before this
    // dependency-injected test adapter rewrites it to the isolated fixture.
    return fetch(mockUrl, { ...init, headers });
  };
}

const observations = [];
const value = await fetchBoundedJson(
  `${EVENTS_API_URL}?skip=0&take=50&sort_by=updated`,
  { method: "GET", headers: { accept: "application/json" } },
  { fetch: createInjectedMockFetch(null, observations) },
);
assert.equal(value.items.length, 3);
assert.equal(new Set(value.items.map((item) => item.id)).size, 1);
assert.match(value.items.at(-1).name, /Changed/u);
assert.deepEqual(observations, [
  {
    productionUrl:
      "https://etkinlik.io/api/v2/events?skip=0&take=50&sort_by=updated",
    redirect: "manual",
  },
]);

for (const [scenario, expectedCode] of [
  ["malformed", "UPSTREAM_INVALID_JSON"],
  ["wrong-content-type", "UPSTREAM_CONTENT_TYPE"],
  ["redirect", "UPSTREAM_REDIRECT"],
]) {
  await expectUpstreamCode(
    () =>
      fetchBoundedJson(
        EVENTS_API_URL,
        {},
        { fetch: createInjectedMockFetch(scenario) },
        { maxAttempts: 1 },
      ),
    expectedCode,
  );
}

await expectUpstreamCode(
  () =>
    fetchBoundedJson(
      EVENTS_API_URL,
      {},
      { fetch: createInjectedMockFetch("oversized") },
      { maxAttempts: 1, maxResponseBytes: 1_024 },
    ),
  "UPSTREAM_BODY_TOO_LARGE",
);

const retryObservations = [];
const retryDelays = [];
await expectUpstreamCode(
  () =>
    fetchBoundedJson(
      EVENTS_API_URL,
      {},
      {
        fetch: createInjectedMockFetch("rate-limit", retryObservations),
        now: () => Date.parse("2026-08-31T12:00:00Z"),
        random: () => 0,
        sleep: (delayMs) => {
          retryDelays.push(delayMs);
          return Promise.resolve();
        },
      },
      { maxAttempts: 3 },
    ),
  "UPSTREAM_429",
);
assert.equal(retryObservations.length, 3);
assert.deepEqual(retryDelays, [1_000, 1_000]);

await expectUpstreamCode(
  () =>
    fetchBoundedJson(
      EVENTS_API_URL,
      {},
      {
        fetch: createInjectedMockFetch("timeout"),
        sleep: () => Promise.resolve(),
      },
      { maxAttempts: 1, timeoutMs: 50 },
    ),
  "UPSTREAM_TIMEOUT",
);

let rejectedUrlReachedAdapter = false;
await expectUpstreamCode(
  () =>
    fetchBoundedJson(
      "https://etkinlik.io/api/v2/events?take=51",
      {},
      {
        fetch: async () => {
          rejectedUrlReachedAdapter = true;
          return new Response("{}");
        },
      },
    ),
  "UPSTREAM_URL_NOT_ALLOWED",
);
assert.equal(rejectedUrlReachedAdapter, false);

console.log(
  JSON.stringify({
    event: "actual_edge_transport_contract_passed",
    productionModule: "supabase/functions/ingest-events/upstreamHttp.ts",
    adapter: "validated-production-url-to-isolated-mock",
    scenarios: [
      "success",
      "malformed-json",
      "wrong-content-type",
      "oversized-body",
      "redirect",
      "bounded-429-retry",
      "timeout",
      "allowlist-before-adapter",
    ],
  }),
);

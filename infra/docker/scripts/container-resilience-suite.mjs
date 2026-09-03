import assert from "node:assert/strict";

const apiUrl = process.env.TOXIPROXY_API_URL;
const proxyUrl = process.env.TOXIPROXY_PROXY_URL;
const mockUrl = process.env.MOCK_BASE_URL;
if (!apiUrl?.startsWith("http://toxiproxy:") || !proxyUrl?.startsWith("http://toxiproxy:")) {
  throw new Error("Toxiproxy endpoints must remain on the isolated Compose network");
}
if (!mockUrl?.startsWith("http://upstream-mock:")) {
  throw new Error("Mock endpoint must remain on the isolated Compose network");
}

async function api(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`TOXIPROXY_API_${response.status}:${await response.text()}`);
  }
  return response;
}

await fetch(`${apiUrl}/proxies/etkinlink-upstream`, { method: "DELETE" }).catch(
  () => undefined,
);
await api("/proxies", {
  method: "POST",
  body: JSON.stringify({
    name: "etkinlink-upstream",
    listen: "0.0.0.0:8666",
    upstream: "upstream-mock:8080",
    enabled: true,
  }),
});

const healthy = await fetch(`${proxyUrl}/health`);
assert.equal(healthy.status, 200);

await api("/proxies/etkinlink-upstream/toxics", {
  method: "POST",
  body: JSON.stringify({
    name: "timeout-downstream",
    type: "timeout",
    stream: "downstream",
    toxicity: 1,
    attributes: { timeout: 50 },
  }),
});
const timeoutController = new AbortController();
const timeout = setTimeout(() => timeoutController.abort(), 500);
await assert.rejects(fetch(`${proxyUrl}/rss/valid.xml`, { signal: timeoutController.signal }));
clearTimeout(timeout);

await api("/proxies/etkinlink-upstream/toxics/timeout-downstream", {
  method: "DELETE",
});
const recovered = await fetch(`${proxyUrl}/rss/valid.xml`);
assert.equal(recovered.status, 200);

await api("/proxies/etkinlink-upstream/toxics", {
  method: "POST",
  body: JSON.stringify({
    name: "latency-upstream",
    type: "latency",
    stream: "upstream",
    toxicity: 1,
    attributes: { latency: 250, jitter: 0 },
  }),
});
const startedAt = Date.now();
assert.equal((await fetch(`${proxyUrl}/api/v2/events`)).status, 200);
assert.ok(Date.now() - startedAt >= 200);
await api("/proxies/etkinlink-upstream/toxics/latency-upstream", {
  method: "DELETE",
});

const idempotencyKey = "resilience-replay-fixed-key";
const send = () =>
  fetch(`${proxyUrl}/contract/push`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ type: "synthetic-existing-contract" }),
  });
const first = await send();
const firstBody = await first.json();
const replay = await send();
const replayBody = await replay.json();
assert.equal(replayBody.ticketId, firstBody.ticketId);
assert.equal(replayBody.duplicate, true);

await api("/proxies/etkinlink-upstream", { method: "DELETE" });
console.log(JSON.stringify({ event: "resilience_suite_passed", recovered: true, duplicateFree: true }));

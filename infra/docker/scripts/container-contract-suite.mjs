import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const baseUrl = process.env.MOCK_BASE_URL;
if (!baseUrl || !baseUrl.startsWith("http://upstream-mock:")) {
  throw new Error("MOCK_BASE_URL must target the isolated Compose mock");
}

async function get(path, init = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
}

const health = await get("/health");
assert.equal(health.status, 200);
assert.equal((await health.json()).fixtureVersion, "2026-08-31.1");

const valid = await get("/rss/valid.xml");
assert.equal(valid.status, 200);
assert.match(valid.headers.get("content-type") ?? "", /rss\+xml/u);
assert.match(await valid.text(), /fixture-4242/u);

const duplicateBody = await (await get("/rss/duplicate.xml")).text();
assert.equal(duplicateBody.match(/fixture-4242/gu)?.length, 2);
const changedBody = await (await get("/rss/changed.xml")).text();
assert.match(changedBody, /Changed/u);
assert.match(await (await get("/rss/malformed.xml")).text(), /broken/u);
assert.match(await (await get("/rss/xxe.xml")).text(), /<!DOCTYPE rss/u);

const oversized = await get("/rss/oversized.xml");
assert.ok(Number(oversized.headers.get("content-length")) > 2 * 1024 * 1024);
await oversized.body?.cancel();

for (const path of ["/rss/redirect-loop", "/rss/disallowed-host"]) {
  const response = await get(path);
  assert.equal(response.status, 302);
}
const rateLimited = await get("/rss/rate-limit");
assert.equal(rateLimited.status, 429);
assert.equal(rateLimited.headers.get("retry-after"), "1");
assert.equal((await get("/rss/503")).status, 503);
assert.match(
  (await get("/rss/wrong-content-type")).headers.get("content-type") ?? "",
  /^text\/plain/u,
);

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 100);
await assert.rejects(get("/rss/timeout", { signal: controller.signal }), {
  name: "AbortError",
});
clearTimeout(timeout);

execFileSync("node", ["infra/docker/scripts/actual-edge-transport-contract.mjs"], {
  cwd: "/workspace",
  env: process.env,
  stdio: "inherit",
});

const events = await get("/api/v2/events");
assert.equal(events.status, 200);
const eventBody = await events.json();
assert.equal(eventBody.items.length, 3);
assert.equal(new Set(eventBody.items.map((item) => item.id)).size, 1);
assert.match(eventBody.items.at(-1).name, /Changed/u);
assert.equal((await get("/api/v2/events", { headers: { "x-mock-scenario": "redirect" } })).status, 302);
assert.equal((await get("/api/v2/events", { headers: { "x-mock-scenario": "rate-limit" } })).status, 429);
assert.equal((await get("/api/v2/events", { headers: { "x-mock-scenario": "unavailable" } })).status, 503);

const push = await fetch(`${baseUrl}/push/send`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ synthetic: 1 }, { synthetic: 2 }] }),
});
assert.equal(push.status, 200);
const tickets = (await push.json()).data;
assert.equal(tickets[0].status, "ok");
assert.equal(tickets[1].details.error, "DeviceNotRegistered");

const key = "contract-message-idempotency-key";
const firstMessage = await fetch(`${baseUrl}/contract/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": key },
  body: JSON.stringify({ roomId: "room-synthetic-1", body: "synthetic" }),
});
const firstMessageBody = await firstMessage.json();
const replayMessage = await fetch(`${baseUrl}/contract/messages`, {
  method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": key },
  body: JSON.stringify({ roomId: "room-synthetic-1", body: "synthetic" }),
});
const replayMessageBody = await replayMessage.json();
assert.equal(firstMessage.status, 201);
assert.equal(replayMessage.status, 200);
assert.equal(replayMessageBody.id, firstMessageBody.id);
assert.equal(replayMessageBody.duplicate, true);

execFileSync("npm", ["--prefix", "infra/cloudflare/etkinlink-edge", "run", "check"], {
  cwd: "/workspace",
  env: process.env,
  stdio: "inherit",
});
execFileSync("npm", ["--prefix", "infra/cloudflare/etkinlink-edge", "run", "dry-run"], {
  cwd: "/workspace",
  env: process.env,
  stdio: "inherit",
});

console.log(JSON.stringify({ event: "contract_suite_passed", fixtureVersion: "2026-08-31.1" }));

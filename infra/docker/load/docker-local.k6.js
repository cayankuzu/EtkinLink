import http from "k6/http";
import { check, fail } from "k6";

const baseUrl = __ENV.CONTRACT_BASE_URL;
const vus = Number(__ENV.K6_VUS || "10");
const duration = __ENV.K6_DURATION || "20s";

if (__ENV.TARGET_ENV !== "docker-test") {
  fail("Docker load profile requires TARGET_ENV=docker-test.");
}
if (baseUrl !== "http://upstream-mock:8080") {
  fail("Docker load profile may only target the isolated synthetic mock.");
}
if (!Number.isInteger(vus) || vus < 1 || vus > 50) {
  fail("Docker smoke load must use 1-50 VUs.");
}
if (!/^([1-9]\d?)(s|m)$/u.test(duration)) {
  fail("K6_DURATION must be a bounded duration such as 20s or 1m.");
}

export const options = {
  vus,
  duration,
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.001"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
  },
};

function idempotencyKey(kind) {
  return `${kind}-${__VU}-${__ITER}-synthetic`;
}

export default function () {
  const events = http.get(`${baseUrl}/contract/events`, { tags: { route: "events" } });
  const detail = http.get(`${baseUrl}/contract/events/4242`, { tags: { route: "event_detail" } });
  const rooms = http.get(`${baseUrl}/contract/rooms`, { tags: { route: "rooms" } });
  const matching = http.get(`${baseUrl}/contract/matching`, { tags: { route: "matching" } });
  const cache = http.get(`${baseUrl}/contract/cache`, { tags: { route: "cache" } });

  const messageKey = idempotencyKey("message");
  const messageParams = {
    headers: { "content-type": "application/json", "idempotency-key": messageKey },
    tags: { route: "messages" },
  };
  const message = http.post(
    `${baseUrl}/contract/messages`,
    JSON.stringify({ roomId: "room-synthetic-1", body: "synthetic load fixture" }),
    messageParams,
  );
  const messageReplay = http.post(
    `${baseUrl}/contract/messages`,
    JSON.stringify({ roomId: "room-synthetic-1", body: "synthetic load fixture" }),
    messageParams,
  );

  const pushKey = idempotencyKey("push");
  const pushParams = {
    headers: { "content-type": "application/json", "idempotency-key": pushKey },
    tags: { route: "push" },
  };
  const push = http.post(`${baseUrl}/contract/push`, "{}", pushParams);
  const pushReplay = http.post(`${baseUrl}/contract/push`, "{}", pushParams);

  check(events, { "public event list is bounded": (r) => r.status === 200 && r.json("items").length === 1 });
  check(detail, { "public event detail resolves": (r) => r.status === 200 && r.json("event.id") === 4242 });
  check(rooms, { "existing room path resolves": (r) => r.status === 200 });
  check(matching, { "existing matching path resolves": (r) => r.status === 200 });
  check(cache, {
    "cache remains public-only": (r) =>
      r.status === 200 && r.json("cacheClass") === "public-event-only" && r.json("forbiddenPersonalizationFields").length === 0,
  });
  check(message, { "message accepted once": (r) => r.status === 201 });
  check(messageReplay, {
    "message replay deduped": (r) => r.status === 200 && r.json("duplicate") === true,
  });
  check(push, { "push outbox accepted once": (r) => r.status === 202 });
  check(pushReplay, {
    "push replay deduped": (r) => r.status === 200 && r.json("duplicate") === true,
  });
}

export function setup() {
  const scheduler = http.post(`${baseUrl}/contract/scheduler`, "{}");
  check(scheduler, {
    "single scheduler contract": (r) => r.status === 200 && r.json("activeSchedulers") === 1,
  });
}

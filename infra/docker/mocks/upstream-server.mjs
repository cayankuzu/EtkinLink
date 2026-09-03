import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { rememberBounded } from "./boundedStore.mjs";

const port = Number.parseInt(process.env.MOCK_PORT ?? "8080", 10);
const maxRequestBytes = Number.parseInt(
  process.env.MOCK_MAX_REQUEST_BYTES ?? "65536",
  10,
);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("MOCK_PORT must be an unprivileged TCP port");
}
if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1024) {
  throw new Error("MOCK_MAX_REQUEST_BYTES is invalid");
}

const fixedNow = "2026-08-31T12:00:00.000Z";
const baseEvent = Object.freeze({
  id: 4242,
  name: "Synthetic EtkinLink Contract Event",
  start: "2026-09-15T17:00:00+03:00",
  start_r001: "2026-09-15T17:00:00+03:00",
  end_r001: "2026-09-15T19:00:00+03:00",
  modified_at: fixedNow,
  url: "https://etkinlik.io/etkinlik/4242/synthetic-contract-event",
  poster_url: "https://etkinlik.io/media/synthetic-contract-event.jpg",
  content: "Synthetic fixture; no user or production data.",
  venue_type: "MANUAL",
  venue_data: {
    name: "Synthetic Venue",
    city_name: "İstanbul",
    district_name: "Kadıköy",
    address: "Synthetic address",
  },
  format: { id: 7, name: "Konser", slug: "konser" },
  category: { id: 9, name: "Müzik", slug: "muzik" },
  tags: [],
  is_free: true,
});

function rssItem({ guid = "fixture-4242", title = baseEvent.name } = {}) {
  return `<item><guid>${guid}</guid><title>${title}</title><link>${baseEvent.url}</link><pubDate>Mon, 31 Aug 2026 09:00:00 GMT</pubDate><description>${baseEvent.content}</description></item>`;
}

function rssDocument(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>EtkinLink synthetic feed</title>${items.join("")}</channel></rss>`;
}

const fixtures = Object.freeze({
  valid: rssDocument([rssItem()]),
  duplicate: rssDocument([rssItem(), rssItem()]),
  changed: rssDocument([
    rssItem({ title: "Synthetic EtkinLink Contract Event - Changed" }),
  ]),
  malformed: "<rss><channel><item><title>broken",
  xxe: `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><title>&xxe;</title></channel></rss>`,
});

const messages = new Map();
const pushes = new Map();
let schedulerClaims = 0;

function json(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function text(response, status, body, contentType, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": contentType,
    ...headers,
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxRequestBytes) {
      const error = new Error("REQUEST_TOO_LARGE");
      error.code = "REQUEST_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stableId(prefix, idempotencyKey) {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex");
  return `${prefix}-${digest.slice(0, 16)}`;
}


async function handleContract(request, response, url) {
  if (request.method === "GET" && url.pathname === "/contract/events") {
    return json(response, 200, { items: [baseEvent], nextCursor: null });
  }
  if (
    request.method === "GET" &&
    /^\/contract\/events\/\d+$/u.test(url.pathname)
  ) {
    return json(response, 200, { event: baseEvent });
  }
  if (request.method === "GET" && url.pathname === "/contract/rooms") {
    return json(response, 200, {
      items: [{ id: "room-synthetic-1", eventId: baseEvent.id }],
    });
  }
  if (request.method === "GET" && url.pathname === "/contract/matching") {
    return json(response, 200, {
      items: [{ id: "candidate-synthetic-1", eventId: baseEvent.id }],
      quotaRemaining: 5,
    });
  }
  if (request.method === "POST" && url.pathname === "/contract/messages") {
    const body = await readBody(request);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128) {
      return json(response, 400, { error: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const previous = messages.get(key);
    const value = previous ?? {
      id: stableId("message", key),
      roomId: body.roomId ?? "room-synthetic-1",
      accepted: true,
    };
    if (!previous) rememberBounded(messages, key, value);
    return json(response, previous ? 200 : 201, {
      ...value,
      duplicate: Boolean(previous),
    });
  }
  if (request.method === "POST" && url.pathname === "/contract/push") {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 8 || key.length > 128) {
      return json(response, 400, { error: "IDEMPOTENCY_KEY_REQUIRED" });
    }
    const previous = pushes.get(key);
    const value = previous ?? {
      ticketId: stableId("ticket", key),
      status: "ok",
    };
    if (!previous) rememberBounded(pushes, key, value);
    return json(response, previous ? 200 : 202, {
      ...value,
      duplicate: Boolean(previous),
    });
  }
  if (request.method === "POST" && url.pathname === "/contract/scheduler") {
    schedulerClaims += 1;
    return json(response, 200, {
      activeSchedulers: 1,
      claim: schedulerClaims,
      leaseOwner: "synthetic-single-scheduler",
    });
  }
  if (request.method === "GET" && url.pathname === "/contract/cache") {
    return json(response, 200, {
      cacheClass: "public-event-only",
      invalidationVersion: 1,
      forbiddenPersonalizationFields: [],
    });
  }
  return false;
}

const server = createServer(async (request, response) => {
  response.setHeader("x-content-type-options", "nosniff");
  const url = new URL(request.url ?? "/", "http://synthetic.invalid");
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        fixtureVersion: "2026-08-31.1",
      });
    }

    if (request.method === "GET" && url.pathname === "/rss/valid.xml") {
      return text(response, 200, fixtures.valid, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/duplicate.xml") {
      return text(response, 200, fixtures.duplicate, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/changed.xml") {
      return text(response, 200, fixtures.changed, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/malformed.xml") {
      return text(response, 200, fixtures.malformed, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/xxe.xml") {
      return text(response, 200, fixtures.xxe, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/oversized.xml") {
      const body = `<?xml version="1.0"?><rss><channel><title>${"x".repeat(
        2 * 1024 * 1024,
      )}</title></channel></rss>`;
      return text(response, 200, body, "application/rss+xml; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/rss/redirect-loop") {
      response.writeHead(302, { location: "/rss/redirect-loop" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/rss/disallowed-host") {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/rss/rate-limit") {
      return json(response, 429, { error: "synthetic_rate_limit" }, { "retry-after": "1" });
    }
    if (request.method === "GET" && url.pathname === "/rss/timeout") {
      return setTimeout(() => {
        if (!response.destroyed) {
          text(response, 200, fixtures.valid, "application/rss+xml; charset=utf-8");
        }
      }, 1_500);
    }
    if (request.method === "GET" && url.pathname === "/rss/503") {
      return json(response, 503, { error: "synthetic_unavailable" });
    }
    if (request.method === "GET" && url.pathname === "/rss/wrong-content-type") {
      return text(response, 200, fixtures.valid, "text/plain; charset=utf-8");
    }

    if (request.method === "GET" && url.pathname === "/api/v2/events") {
      const scenario = request.headers["x-mock-scenario"];
      if (scenario === "malformed") {
        return text(response, 200, "{broken", "application/json; charset=utf-8");
      }
      if (scenario === "oversized") {
        return json(response, 200, { padding: "x".repeat(2 * 1024 * 1024) });
      }
      if (scenario === "wrong-content-type") {
        return text(response, 200, JSON.stringify({ items: [baseEvent] }), "text/plain");
      }
      if (scenario === "redirect") {
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        return response.end();
      }
      if (scenario === "rate-limit") {
        return json(response, 429, { error: "synthetic_rate_limit" }, { "retry-after": "1" });
      }
      if (scenario === "unavailable") {
        return json(response, 503, { error: "synthetic_unavailable" });
      }
      if (scenario === "timeout") {
        return setTimeout(() => {
          if (!response.destroyed) {
            json(response, 200, { items: [baseEvent] });
          }
        }, 1_500);
      }
      return json(response, 200, {
        items: [baseEvent, { ...baseEvent }, { ...baseEvent, name: `${baseEvent.name} - Changed` }],
        meta: { total_count: 1 },
      });
    }
    if (
      request.method === "GET" &&
      /^\/api\/v2\/events\/\d+$/u.test(url.pathname)
    ) {
      return json(response, 200, baseEvent);
    }
    if (request.method === "GET" && url.pathname === "/api/v2/cities") {
      return json(response, 200, [{ id: 34, name: "İstanbul", slug: "istanbul" }]);
    }
    if (request.method === "GET" && url.pathname === "/api/v2/formats") {
      return json(response, 200, [baseEvent.format]);
    }
    if (request.method === "GET" && url.pathname === "/api/v2/categories") {
      return json(response, 200, [baseEvent.category]);
    }

    if (request.method === "POST" && url.pathname === "/push/send") {
      const body = await readBody(request);
      const count = Array.isArray(body.messages) ? body.messages.length : 1;
      return json(response, 200, {
        data: Array.from({ length: count }, (_, index) =>
          index === count - 1 && count > 1
            ? { status: "error", details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: `synthetic-ticket-${index + 1}` }),
      });
    }
    if (request.method === "POST" && url.pathname === "/push/receipts") {
      return json(response, 200, {
        data: {
          "synthetic-ticket-1": { status: "ok" },
          "synthetic-ticket-2": {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      });
    }

    const contractResult = await handleContract(request, response, url);
    if (contractResult !== false) return contractResult;
    return json(response, 404, { error: "SYNTHETIC_ROUTE_NOT_FOUND" });
  } catch (error) {
    if (error?.code === "REQUEST_TOO_LARGE") {
      return json(response, 413, { error: "REQUEST_TOO_LARGE" });
    }
    if (error instanceof SyntaxError) {
      return json(response, 400, { error: "INVALID_JSON" });
    }
    return json(response, 500, {
      error: "SYNTHETIC_INTERNAL_ERROR",
      requestId: randomUUID(),
    });
  }
});

function shutdown() {
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "mock_ready", port, fixtureVersion: "2026-08-31.1" }));
});
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

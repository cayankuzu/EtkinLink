import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { handleRequest } from "../src";
import { createInternalSignature } from "../src/security";
import {
  accessToken,
  eventFixture,
  JWKS,
  ORIGIN,
  signingFixture,
  testEnv,
  USER_A,
  USER_B,
} from "./fixtures";
import { network } from "./network";

describe("selective event gateway", () => {
  let signing: Awaited<ReturnType<typeof signingFixture>>;

  beforeEach(async () => {
    signing = await signingFixture();
    network.use(http.get(JWKS, () => HttpResponse.json(signing.jwks)));
  });

  it("fails closed when a deploy placeholder origin reaches runtime", async () => {
    const response = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog"),
      testEnv({
        ORIGIN_BASE_URL: "https://preview-supabase.invalid/functions/v1",
        JWT_ISSUER: "https://preview-supabase.invalid/auth/v1",
        JWKS_URL:
          "https://preview-supabase.invalid/auth/v1/.well-known/jwks.json",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Edge yapılandırması geçersiz.",
    });
  });

  it("preserves the current POST body and list response contract", async () => {
    const token = await accessToken(signing.privateKey);
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, async ({ request }) => {
        expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
        expect(await request.json()).toEqual({
          action: "list",
          city: "İstanbul",
          formats: ["Konser"],
          startAt: null,
          endAt: null,
          sort: "upcoming",
          skip: 0,
          take: 30,
        });
        return HttpResponse.json({
          events: [eventFixture],
          total: 1,
          nextSkip: null,
        });
      }),
    );
    const response = await handleRequest(
      new Request("https://api.etkinlink.app/v1/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "list",
          city: "İstanbul",
          formats: ["Konser"],
          startAt: null,
          endAt: null,
          sort: "upcoming",
          skip: 0,
          take: 30,
        }),
      }),
      testEnv(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      events: [eventFixture],
      total: 1,
      nextSkip: null,
    });
  });

  it("keeps authenticated user responses out of shared cache", async () => {
    let originCalls = 0;
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, () => {
        originCalls += 1;
        return HttpResponse.json({
          events: [eventFixture],
          total: 1,
          nextSkip: null,
        });
      }),
    );
    for (const subject of [USER_A, USER_B]) {
      const token = await accessToken(signing.privateKey, { subject });
      const response = await handleRequest(
        new Request("https://api.etkinlink.app/v1/events?take=30", {
          headers: { authorization: `Bearer ${token}` },
        }),
        testEnv(),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
    }
    expect(originCalls).toBe(2);
  });

  it("rejects unknown paths, methods, queries and oversized bodies", async () => {
    const token = await accessToken(signing.privateKey);
    const env = testEnv();
    const unknown = await handleRequest(
      new Request("https://api.etkinlink.app/auth/v1/token"),
      env,
    );
    expect(unknown.status).toBe(404);
    const method = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog", { method: "DELETE" }),
      env,
    );
    expect(method.status).toBe(405);
    const query = await handleRequest(
      new Request("https://api.etkinlink.app/v1/events?joined=true", {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(query.status).toBe(400);
    const oversized = await handleRequest(
      new Request("https://api.etkinlink.app/v1/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "catalog",
          padding: "x".repeat(17_000),
        }),
      }),
      env,
    );
    expect(oversized.status).toBe(413);
  });

  it("accepts missing Origin for native clients and rejects non-allowlisted web origins", async () => {
    const token = await accessToken(signing.privateKey);
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, () =>
        HttpResponse.json({ cities: [], formats: [], categories: [] }),
      ),
    );
    const nativeResponse = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog", {
        headers: { authorization: `Bearer ${token}` },
      }),
      testEnv(),
    );
    expect(nativeResponse.status).toBe(200);
    expect(
      nativeResponse.headers.get("access-control-allow-origin"),
    ).toBeNull();
    const browserResponse = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog", {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "https://attacker.example",
        },
      }),
      testEnv(),
    );
    expect(browserResponse.status).toBe(403);
  });

  it("fails closed when the user rate-limit binding rejects the request", async () => {
    const token = await accessToken(signing.privateKey);
    const denied: RateLimit = { limit: async () => ({ success: false }) };
    const response = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog", {
        headers: { authorization: `Bearer ${token}` },
      }),
      testEnv({}, denied),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("fails closed when the rate-limit binding is unavailable", async () => {
    const token = await accessToken(signing.privateKey);
    const unavailable: RateLimit = {
      limit: async () => Promise.reject(new Error("binding unavailable")),
    };
    const response = await handleRequest(
      new Request("https://api.etkinlink.app/v1/catalog", {
        headers: { authorization: `Bearer ${token}` },
      }),
      testEnv({}, unavailable),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("internal ingestion trigger", () => {
  it("requires HMAC and rejects a replayed nonce before reaching origin twice", async () => {
    const body = "{}";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "44444444-4444-4444-8444-444444444444";
    const env = testEnv();
    const signature = await createInternalSignature(
      env.INTERNAL_TRIGGER_HMAC_SECRET,
      timestamp,
      nonce,
      body,
    );
    const seen = new Set<string>();
    const replayLimiter: RateLimit = {
      limit: async ({ key }) => {
        if (seen.has(key)) return { success: false };
        seen.add(key);
        return { success: true };
      },
    };
    let originCalls = 0;
    network.use(
      http.post(`${ORIGIN}/ingest-events`, ({ request }) => {
        originCalls += 1;
        expect(request.headers.get("x-cron-secret")).toBe(
          env.ORIGIN_INGEST_SECRET,
        );
        return HttpResponse.json({ upserted: 3 });
      }),
    );
    const configured = testEnv({ INGEST_RATE_LIMITER: replayLimiter });
    const makeRequest = () =>
      new Request("https://api.etkinlink.app/internal/ingest-events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-etkinlink-timestamp": timestamp,
          "x-etkinlink-nonce": nonce,
          "x-etkinlink-signature": signature,
        },
        body,
      });
    expect((await handleRequest(makeRequest(), configured)).status).toBe(200);
    expect((await handleRequest(makeRequest(), configured)).status).toBe(409);
    expect(originCalls).toBe(1);
  });

  it("does not accept the client JWT as internal authorization", async () => {
    const response = await handleRequest(
      new Request("https://api.etkinlink.app/internal/ingest-events", {
        method: "POST",
        headers: {
          authorization: "Bearer user-token",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      testEnv(),
    );
    expect(response.status).toBe(401);
  });
});

import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { RuntimeConfig } from "../src/config";
import { fetchEventApi, OriginFailure } from "../src/origin";
import { eventFixture, ORIGIN } from "./fixtures";
import { network } from "./network";

const config: RuntimeConfig = {
  environment: "test",
  originBaseUrl: new URL(ORIGIN),
  jwtIssuer: "https://issuer.example",
  jwtAudience: "authenticated",
  jwksUrl: "https://issuer.example/jwks",
  allowedOrigins: new Set(),
  originTimeoutMs: 20,
  maxOriginResponseBytes: 1_572_864,
};

describe("origin transport", () => {
  it("retries only an explicitly idempotent gateway GET and honors Retry-After", async () => {
    let attempts = 0;
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, () => {
        attempts += 1;
        if (attempts < 3) {
          return HttpResponse.json(
            { error: "busy" },
            { status: 429, headers: { "retry-after": "0" } },
          );
        }
        return HttpResponse.json({
          events: [eventFixture],
          total: 1,
          nextSkip: null,
        });
      }),
    );
    await expect(
      fetchEventApi(
        config,
        crypto.randomUUID(),
        "Bearer token",
        { action: "list", skip: 0, take: 30 },
        true,
      ),
    ).resolves.toMatchObject({ total: 1 });
    expect(attempts).toBe(3);
  });

  it("does not retry the compatibility POST", async () => {
    let attempts = 0;
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, () => {
        attempts += 1;
        return HttpResponse.json({ error: "busy" }, { status: 503 });
      }),
    );
    await expect(
      fetchEventApi(
        config,
        crypto.randomUUID(),
        "Bearer token",
        { action: "catalog" },
        false,
      ),
    ).rejects.toBeInstanceOf(OriginFailure);
    expect(attempts).toBe(1);
  });

  it("times out a stalled origin response", async () => {
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    await expect(
      fetchEventApi(
        config,
        crypto.randomUUID(),
        "Bearer token",
        { action: "catalog" },
        false,
      ),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("rejects personalized or malformed event payloads", async () => {
    network.use(
      http.post(`${ORIGIN}/etkinlik-api`, () =>
        HttpResponse.json({
          events: [{ ...eventFixture, joined: true }],
          total: 1,
          nextSkip: null,
        }),
      ),
    );
    await expect(
      fetchEventApi(
        config,
        crypto.randomUUID(),
        "Bearer token",
        { action: "list" },
        false,
      ),
    ).rejects.toMatchObject({ status: 502, message: "ORIGIN_SCHEMA_INVALID" });
  });

  it("rejects oversized and non-JSON origin responses before parsing", async () => {
    network.use(
      http.post(
        `${ORIGIN}/etkinlik-api`,
        () =>
          new HttpResponse("not-json", {
            headers: {
              "content-type": "text/plain",
              "content-length": "2000000",
            },
          }),
      ),
    );
    await expect(
      fetchEventApi(
        config,
        crypto.randomUUID(),
        "Bearer token",
        { action: "catalog" },
        false,
      ),
    ).rejects.toBeInstanceOf(OriginFailure);
  });
});

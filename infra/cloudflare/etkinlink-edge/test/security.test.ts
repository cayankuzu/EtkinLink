import type { JWTVerifyGetKey } from "jose";
import { describe, expect, it } from "vitest";

import {
  createInternalSignature,
  verifyAccessToken,
  verifyInternalSignature,
} from "../src/security";
import {
  accessToken,
  AUDIENCE,
  ISSUER,
  JWKS,
  signingFixture,
  USER_A,
} from "./fixtures";

describe("JWT verification", () => {
  it("accepts a valid signature, issuer, audience, expiry and role", async () => {
    const signing = await signingFixture();
    const token = await accessToken(signing.privateKey);
    const resolver: JWTVerifyGetKey = async () => signing.publicKey;
    await expect(
      verifyAccessToken(
        token,
        { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS },
        resolver,
      ),
    ).resolves.toEqual({ sub: USER_A });
  });

  it.each([
    { name: "issuer", token: { issuer: "https://attacker.example" } },
    { name: "audience", token: { audience: "other" } },
    { name: "expiry", token: { expiresIn: -60 } },
    { name: "not-before", token: { notBefore: "10m" } },
  ])("rejects an invalid $name claim", async ({ token: options }) => {
    const signing = await signingFixture();
    const token = await accessToken(signing.privateKey, options);
    const resolver: JWTVerifyGetKey = async () => signing.publicKey;
    await expect(
      verifyAccessToken(
        token,
        { issuer: ISSUER, audience: AUDIENCE, jwksUrl: JWKS },
        resolver,
      ),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("internal HMAC verification", () => {
  it("binds the timestamp, nonce and exact body", async () => {
    const secret = "a-secure-test-secret-with-32-characters";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "33333333-3333-4333-8333-333333333333";
    const body = "{}";
    const signature = await createInternalSignature(
      secret,
      timestamp,
      nonce,
      body,
    );
    const request = new Request(
      "https://api.etkinlink.app/internal/ingest-events",
      {
        method: "POST",
        headers: {
          "x-etkinlink-timestamp": timestamp,
          "x-etkinlink-nonce": nonce,
          "x-etkinlink-signature": signature,
        },
      },
    );
    await expect(
      verifyInternalSignature(request, body, secret),
    ).resolves.toEqual({
      nonce,
    });
    await expect(
      verifyInternalSignature(request, '{"changed":true}', secret),
    ).rejects.toThrow("HMAC_SIGNATURE_INVALID");
  });

  it("rejects stale signed requests", async () => {
    const secret = "a-secure-test-secret-with-32-characters";
    const timestamp = String(Math.floor(Date.now() / 1000) - 61);
    const nonce = "33333333-3333-4333-8333-333333333333";
    const signature = await createInternalSignature(
      secret,
      timestamp,
      nonce,
      "{}",
    );
    const request = new Request(
      "https://api.etkinlink.app/internal/ingest-events",
      {
        headers: {
          "x-etkinlink-timestamp": timestamp,
          "x-etkinlink-nonce": nonce,
          "x-etkinlink-signature": signature,
        },
      },
    );
    await expect(
      verifyInternalSignature(request, "{}", secret),
    ).rejects.toThrow("HMAC_HEADERS_INVALID");
  });
});

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/i;
const MAX_CLOCK_SKEW_SECONDS = 60;

export type JwtIdentity = { sub: string };

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return null;
    bytes[index] = byte;
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyAccessToken(
  token: string,
  configuration: {
    issuer: string;
    audience: string;
    jwksUrl: string;
  },
  keyResolver?: JWTVerifyGetKey,
): Promise<JwtIdentity> {
  const jwks =
    keyResolver ?? createRemoteJWKSet(new URL(configuration.jwksUrl));
  const { payload } = await jwtVerify(token, jwks, {
    algorithms: ["ES256", "RS256"],
    issuer: configuration.issuer,
    audience: configuration.audience,
    clockTolerance: 5,
  });
  if (
    typeof payload.sub !== "string" ||
    !UUID_PATTERN.test(payload.sub) ||
    payload.role !== "authenticated"
  ) {
    throw new Error("JWT_CLAIMS_INVALID");
  }
  return { sub: payload.sub };
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
  return match?.[1] ?? null;
}

export async function createInternalSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): Promise<string> {
  const bodyHash = await sha256Hex(body);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}\n${nonce}\n${bodyHash}`),
  );
  return `v1=${bytesToHex(new Uint8Array(signature))}`;
}

export async function verifyInternalSignature(
  request: Request,
  body: string,
  secret: string,
  nowMs = Date.now(),
): Promise<{ nonce: string }> {
  if (secret.length < 32) throw new Error("HMAC_CONFIGURATION_INVALID");
  const timestamp = request.headers.get("x-etkinlink-timestamp") ?? "";
  const nonce = request.headers.get("x-etkinlink-nonce") ?? "";
  const supplied = request.headers.get("x-etkinlink-signature") ?? "";
  const timestampSeconds = Number(timestamp);
  const signatureMatch = SIGNATURE_PATTERN.exec(supplied);
  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(Math.floor(nowMs / 1000) - timestampSeconds) >
      MAX_CLOCK_SKEW_SECONDS ||
    !UUID_PATTERN.test(nonce) ||
    !signatureMatch
  ) {
    throw new Error("HMAC_HEADERS_INVALID");
  }
  const expected = await createInternalSignature(
    secret,
    timestamp,
    nonce,
    body,
  );
  const expectedBytes = hexToBytes(expected.slice(3));
  const suppliedHex = signatureMatch[1];
  const suppliedBytes = suppliedHex ? hexToBytes(suppliedHex) : null;
  if (
    !expectedBytes ||
    !suppliedBytes ||
    !constantTimeEqual(expectedBytes, suppliedBytes)
  ) {
    throw new Error("HMAC_SIGNATURE_INVALID");
  }
  return { nonce };
}

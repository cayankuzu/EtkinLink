import { exportJWK, generateKeyPair, SignJWT } from "jose";

export const ORIGIN = "https://hwolchgllljzzvwnzool.supabase.co/functions/v1";
export const ISSUER = "https://hwolchgllljzzvwnzool.supabase.co/auth/v1";
export const JWKS = `${ISSUER}/.well-known/jwks.json`;
export const AUDIENCE = "authenticated";
export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";

export const eventFixture = {
  id: "etkinlik-io-42",
  databaseId: null,
  externalId: 42,
  title: "Test Etkinliği",
  summary: "Özet",
  description: "Açıklama",
  startAt: "2026-09-10T17:00:00.000Z",
  endAt: "2026-09-10T19:00:00.000Z",
  venue: "Test Alanı",
  city: "İstanbul",
  district: "Kadıköy",
  address: null,
  imageUrl: "https://images.example.test/event.jpg",
  categories: ["Konser"],
  sourceUrl: "https://etkinlik.io/event/42",
  attendeeCount: 0,
  attendeePhotoUrls: [],
  joined: false,
  saved: false,
  sourceDetails: {
    status: null,
    attendanceMode: "VENUE",
    updatedAt: "2026-08-30T10:00:00.000Z",
    organizer: null,
    performers: [],
    price: null,
    currency: null,
    ticketUrl: null,
    availability: null,
    ageRange: null,
    isAccessibleForFree: false,
    doorTime: null,
    duration: null,
  },
};

export async function signingFixture(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  jwks: { keys: Record<string, unknown>[] };
}> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  return {
    privateKey,
    publicKey,
    jwks: {
      keys: [{ ...publicJwk, alg: "ES256", kid: "test-key", use: "sig" }],
    },
  };
}

export async function accessToken(
  privateKey: CryptoKey,
  options: {
    subject?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string | number;
    notBefore?: string | number;
  } = {},
): Promise<string> {
  let token = new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setSubject(options.subject ?? USER_A)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m");
  if (options.notBefore !== undefined)
    token = token.setNotBefore(options.notBefore);
  return token.sign(privateKey);
}

export function testEnv(
  overrides: Partial<Env> = {},
  rateLimit: RateLimit = { limit: async () => ({ success: true }) },
): Env {
  return {
    API_RATE_LIMITER: rateLimit,
    INGEST_RATE_LIMITER: rateLimit,
    ENVIRONMENT: "development",
    ORIGIN_BASE_URL: ORIGIN as Env["ORIGIN_BASE_URL"],
    JWT_ISSUER: ISSUER as Env["JWT_ISSUER"],
    JWT_AUDIENCE: AUDIENCE,
    JWKS_URL: JWKS as Env["JWKS_URL"],
    ALLOWED_ORIGINS: "http://localhost:8081,http://localhost:19006",
    ORIGIN_TIMEOUT_MS: "12000",
    MAX_ORIGIN_RESPONSE_BYTES: "1572864",
    INTERNAL_TRIGGER_HMAC_SECRET: "hmac-test-secret-at-least-32-characters",
    ORIGIN_INGEST_SECRET: "origin-test-secret-at-least-32-characters",
    ...overrides,
  };
}

export type RuntimeConfig = {
  environment: string;
  originBaseUrl: URL;
  jwtIssuer: string;
  jwtAudience: string;
  jwksUrl: string;
  allowedOrigins: ReadonlySet<string>;
  originTimeoutMs: number;
  maxOriginResponseBytes: number;
};

function boundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`CONFIG_${name}_INVALID`);
  }
  return parsed;
}

function secureUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`CONFIG_${name}_INVALID`);
  }
  return url;
}

export function runtimeConfig(env: Env): RuntimeConfig {
  const originBaseUrl = secureUrl(env.ORIGIN_BASE_URL, "ORIGIN_BASE_URL");
  const issuer = secureUrl(env.JWT_ISSUER, "JWT_ISSUER");
  const jwks = secureUrl(env.JWKS_URL, "JWKS_URL");
  if (
    originBaseUrl.hostname.endsWith(".invalid") ||
    issuer.hostname.endsWith(".invalid") ||
    jwks.hostname.endsWith(".invalid")
  ) {
    throw new Error("CONFIG_PLACEHOLDER_ORIGIN");
  }
  if (issuer.origin !== jwks.origin || originBaseUrl.origin !== issuer.origin) {
    throw new Error("CONFIG_ORIGIN_IDENTITY_MISMATCH");
  }
  const allowedOrigins = new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const allowedOrigin of allowedOrigins) {
    const parsed = new URL(allowedOrigin);
    const local =
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (
      (parsed.protocol !== "https:" && !local) ||
      parsed.origin !== allowedOrigin
    ) {
      throw new Error("CONFIG_ALLOWED_ORIGINS_INVALID");
    }
  }
  return {
    environment: env.ENVIRONMENT,
    originBaseUrl,
    jwtIssuer: issuer.toString().replace(/\/$/, ""),
    jwtAudience: env.JWT_AUDIENCE,
    jwksUrl: jwks.toString(),
    allowedOrigins,
    originTimeoutMs: boundedInteger(
      env.ORIGIN_TIMEOUT_MS,
      "ORIGIN_TIMEOUT_MS",
      1_000,
      20_000,
    ),
    maxOriginResponseBytes: boundedInteger(
      env.MAX_ORIGIN_RESPONSE_BYTES,
      "MAX_ORIGIN_RESPONSE_BYTES",
      1_024,
      2_000_000,
    ),
  };
}

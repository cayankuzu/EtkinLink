/* global URL, console, process */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const REQUIRED_VALUES = [
  "ORIGIN_BASE_URL",
  "JWT_ISSUER",
  "JWT_AUDIENCE",
  "JWKS_URL",
  "ALLOWED_ORIGINS",
  "PREVIEW_SUPABASE_PROJECT_REF",
  "PRODUCTION_SUPABASE_PROJECT_REF",
];

function parseUrl(value, label) {
  if (value !== value.trim()) {
    throw new Error(`${label} must not contain surrounding whitespace.`);
  }
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
}

export function validateDeploymentEnvironment(environment, values) {
  if (environment !== "preview" && environment !== "production") {
    throw new Error("Environment must be preview or production.");
  }
  for (const name of REQUIRED_VALUES) {
    if (typeof values[name] !== "string" || !values[name].trim()) {
      throw new Error(`${name} is required in the ${environment} environment.`);
    }
  }

  const previewRef = values.PREVIEW_SUPABASE_PROJECT_REF;
  const productionRef = values.PRODUCTION_SUPABASE_PROJECT_REF;
  if (
    !PROJECT_REF_PATTERN.test(previewRef) ||
    !PROJECT_REF_PATTERN.test(productionRef) ||
    previewRef === productionRef
  ) {
    throw new Error(
      "Preview and production Supabase project refs must be valid and distinct.",
    );
  }

  const selectedRef = environment === "preview" ? previewRef : productionRef;
  const otherRef = environment === "preview" ? productionRef : previewRef;
  const origin = parseUrl(values.ORIGIN_BASE_URL, "ORIGIN_BASE_URL");
  const issuer = parseUrl(values.JWT_ISSUER, "JWT_ISSUER");
  const jwks = parseUrl(values.JWKS_URL, "JWKS_URL");
  const identityUrls = [origin, issuer, jwks];
  if (
    identityUrls.some(
      (url) =>
        url.protocol !== "https:" || url.username || url.password || url.port,
    )
  ) {
    throw new Error(
      "Origin identity URLs must be credential-free HTTPS URLs without a non-default port.",
    );
  }

  const expectedHostname = `${selectedRef}.supabase.co`;
  const expectedPaths = [
    [origin, "/functions/v1"],
    [issuer, "/auth/v1"],
    [jwks, "/auth/v1/.well-known/jwks.json"],
  ];
  if (
    origin.origin !== issuer.origin ||
    issuer.origin !== jwks.origin ||
    origin.hostname !== expectedHostname ||
    origin.hostname === `${otherRef}.supabase.co` ||
    expectedPaths.some(
      ([url, path]) => url.pathname !== path || url.search || url.hash,
    )
  ) {
    throw new Error(
      `${environment} origin/JWT/JWKS bindings must use the declared ${environment} Supabase project and exact paths.`,
    );
  }
  if (values.JWT_AUDIENCE !== "authenticated") {
    throw new Error("Unexpected JWT audience.");
  }

  const allowedOrigins = values.ALLOWED_ORIGINS.split(",").map((value) =>
    value.trim(),
  );
  for (const value of allowedOrigins) {
    const allowed = parseUrl(value, `${environment} CORS origin`);
    if (
      allowed.protocol !== "https:" ||
      allowed.username ||
      allowed.password ||
      allowed.port ||
      allowed.pathname !== "/" ||
      allowed.search ||
      allowed.hash ||
      allowed.origin !== value
    ) {
      throw new Error(
        `${environment} CORS origins must be bare credential-free HTTPS origins.`,
      );
    }
  }
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
  try {
    validateDeploymentEnvironment(option("environment"), process.env);
    console.log("Environment-scoped Supabase bindings are valid.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

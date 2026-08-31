import { describe, expect, it } from "vitest";

import { validateDeploymentEnvironment } from "../scripts/validate-deployment-environment.mjs";

const previewRef = "abcdefghijklmnopqrst";
const productionRef = "0123456789abcdefghij";

function environmentValues(environment) {
  const projectRef = environment === "preview" ? previewRef : productionRef;
  return {
    ORIGIN_BASE_URL: `https://${projectRef}.supabase.co/functions/v1`,
    JWT_ISSUER: `https://${projectRef}.supabase.co/auth/v1`,
    JWT_AUDIENCE: "authenticated",
    JWKS_URL: `https://${projectRef}.supabase.co/auth/v1/.well-known/jwks.json`,
    ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com",
    PREVIEW_SUPABASE_PROJECT_REF: previewRef,
    PRODUCTION_SUPABASE_PROJECT_REF: productionRef,
  };
}

describe("environment-scoped Supabase deployment guard", () => {
  it.each(["preview", "production"])(
    "accepts exact %s project hosts and paths",
    (environment) => {
      expect(() =>
        validateDeploymentEnvironment(
          environment,
          environmentValues(environment),
        ),
      ).not.toThrow();
    },
  );

  it("rejects preview bindings pointed at production", () => {
    expect(() =>
      validateDeploymentEnvironment("preview", environmentValues("production")),
    ).toThrow(/declared preview Supabase project/u);
  });

  it("rejects identical project refs", () => {
    expect(() =>
      validateDeploymentEnvironment("preview", {
        ...environmentValues("preview"),
        PRODUCTION_SUPABASE_PROJECT_REF: previewRef,
      }),
    ).toThrow(/valid and distinct/u);
  });

  it.each([
    [
      "query",
      {
        ORIGIN_BASE_URL: `https://${previewRef}.supabase.co/functions/v1?leak=1`,
      },
    ],
    [
      "trailing slash",
      {
        ORIGIN_BASE_URL: `https://${previewRef}.supabase.co/functions/v1/`,
      },
    ],
    ["wrong path", { JWT_ISSUER: `https://${previewRef}.supabase.co/auth/v2` }],
    [
      "port",
      {
        JWKS_URL: `https://${previewRef}.supabase.co:8443/auth/v1/.well-known/jwks.json`,
      },
    ],
    ["audience", { JWT_AUDIENCE: "service_role" }],
    ["CORS path", { ALLOWED_ORIGINS: "https://app.example.com/path" }],
    [
      "surrounding whitespace",
      {
        JWT_ISSUER: ` https://${previewRef}.supabase.co/auth/v1`,
      },
    ],
  ])("rejects unsafe %s binding", (_label, override) => {
    expect(() =>
      validateDeploymentEnvironment("preview", {
        ...environmentValues("preview"),
        ...override,
      }),
    ).toThrow();
  });
});

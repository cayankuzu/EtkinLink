import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeOutput, unsafeEvidenceLabels } from "./_common.mjs";

test("sanitizeOutput redacts JSON, env, JWT, database, and bearer secrets", () => {
  const source = [
    JSON.stringify({
      PUBLISHABLE_KEY: "sb_publishable_example",
      SECRET_KEY: "sb_secret_example",
      JWT_SECRET: "local-jwt-secret",
      S3_PROTOCOL_ACCESS_KEY_SECRET: "s3-secret",
      API_URL: "http://127.0.0.1:55321",
    }),
    "PASSWORD=plain-password ACCESS_TOKEN:plain-token",
    "postgresql://postgres:database-password@127.0.0.1:55322/postgres",
    "authorization: Bearer bearer-token-value",
    `ANON_KEY=eyJ${"a".repeat(80)}`,
  ].join("\n");

  const sanitized = sanitizeOutput(source);

  for (const secret of [
    "sb_publishable_example",
    "sb_secret_example",
    "local-jwt-secret",
    "s3-secret",
    "plain-password",
    "plain-token",
    "database-password",
    "bearer-token-value",
    `eyJ${"a".repeat(80)}`,
  ]) {
    assert.equal(sanitized.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(sanitized, /"API_URL":"http:\/\/127\.0\.0\.1:55321"/u);
  assert.match(sanitized, /"PUBLISHABLE_KEY":"\[REDACTED\]"/u);
});

test("sanitizeOutput leaves ordinary diagnostics intact", () => {
  assert.equal(
    sanitizeOutput("status=healthy url=https://example.test/path"),
    "status=healthy url=https://example.test/path",
  );
});

test("unsafeEvidenceLabels rejects raw secrets but accepts redacted evidence", () => {
  assert.deepEqual(
    unsafeEvidenceLabels(
      '{"SECRET_KEY":"sb_secret_examplevalue","JWT_SECRET":"plain"}',
    ).sort(),
    ["json-secret", "supabase-key"],
  );
  assert.deepEqual(
    unsafeEvidenceLabels(
      '{"SECRET_KEY":"[REDACTED]"}\nPASSWORD=[REDACTED]\n' +
        "postgresql://postgres:[REDACTED]@127.0.0.1/db",
    ),
    [],
  );
});

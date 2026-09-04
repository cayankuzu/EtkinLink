import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeOutput,
  summarizeSupabaseStart,
  unsafeEvidenceLabels,
} from "./_common.mjs";

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

test("summarizeSupabaseStart keeps replay evidence and withholds every credential", () => {
  const raw = [
    JSON.stringify({
      DB_URL: "postgresql://postgres:local-db-password@127.0.0.1:55322/postgres",
      API_URL: "http://127.0.0.1:55321",
      PUBLISHABLE_KEY: "sb_publishable_localvalue",
      SECRET_KEY: "sb_secret_localvalue",
      SERVICE_ROLE_KEY: `eyJ${"a".repeat(80)}`,
      S3_PROTOCOL_ACCESS_KEY_SECRET: "s3-protocol-secret-value",
    }),
    "Starting database...",
    "Initialising schema...",
    "Applying migration 20260805220000_initial_production_schema.sql...",
    "Seeding data from supabase/seed.sql...",
  ].join("\n");

  const summary = summarizeSupabaseStart(raw);

  for (const secret of [
    "local-db-password",
    "sb_publishable_localvalue",
    "sb_secret_localvalue",
    `eyJ${"a".repeat(80)}`,
    "s3-protocol-secret-value",
  ]) {
    assert.equal(summary.includes(secret), false, `leaked ${secret}`);
  }
  assert.deepEqual(unsafeEvidenceLabels(sanitizeOutput(summary)), []);
  assert.match(
    summary,
    /Applying migration 20260805220000_initial_production_schema\.sql\.\.\./u,
  );
  assert.match(summary, /Seeding data from supabase\/seed\.sql\.\.\./u);
  // Field names are evidence that the stack came up; their values never are.
  assert.match(summary, /stack status fields \(values withheld\): .*SECRET_KEY/u);
  assert.match(summary, /summary: 5 evidence lines kept, 0 unrecognised lines withheld/u);
});

test("summarizeSupabaseStart drops unrecognised output instead of forwarding it", () => {
  const summary = summarizeSupabaseStart(
    ["Starting database...", "anon key: sb_publishable_surprisingformat"].join("\n"),
  );

  assert.equal(summary.includes("sb_publishable_surprisingformat"), false);
  assert.match(summary, /summary: 1 evidence lines kept, 1 unrecognised lines withheld/u);
});

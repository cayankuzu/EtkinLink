/**
 * Reads a raw `supabase start` / `supabase db start` log and writes the
 * evidence-safe summary to stdout.
 *
 * CI captures the CLI's output with a shell redirect, so it cannot reach the
 * summariser the Docker profiles use. Without this entry point the workflow
 * would `tee` the raw output — which carries the local stack's publishable and
 * secret keys, the service-role JWT, the database password and the S3 protocol
 * secrets — straight into an uploaded artifact.
 *
 * Usage: node infra/docker/scripts/summarize-supabase-log.mjs <raw-log-path>
 */
import { readFile } from "node:fs/promises";
import { sanitizeOutput, summarizeSupabaseStart } from "./_common.mjs";

const [source] = process.argv.slice(2);
if (!source) {
  throw new Error("Usage: summarize-supabase-log.mjs <raw-log-path>");
}

process.stdout.write(
  sanitizeOutput(summarizeSupabaseStart(await readFile(source, "utf8"))),
);

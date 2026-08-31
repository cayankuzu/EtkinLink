# Observability and baseline-derived SLO runbook

## Telemetry contract

Every signal must carry environment, release/commit SHA, app version, runtimeVersion, channel and platform where applicable. HTTP correlation uses client request ID, Worker request ID/`cf-ray`, and Supabase function request ID. Never log access/refresh tokens, authorization/cookie headers, precise location, message/report text, signed URLs, email, username or media content.

Required families are startup/screen-ready, API p50/p95/p99 and error ratio, auth outcomes/lockouts, mutation conflict/retry/dead-letter, Realtime reconnect/gap, upload throughput/orphans, push ticket/receipt, Worker origin/cache/rate-limit, DB pool/locks/slow queries, and crash-free sessions/users.

## No invented targets

The repository has no same-SHA physical-device/production baseline. Therefore no latency, availability or crash-free value is claimed achieved. Existing `%99.5` monitoring configuration is a provisional release-health gate, not a measured SLO.

Before enabling an alert:

1. Select an isolated staging and then production observation window covering normal peak/off-peak traffic; record exact UTC bounds and sample count.
2. Exclude synthetic traffic by an explicit non-PII tag; do not discard failures.
3. Export raw count, success count and p50/p95/p99 for each supported platform/network class.
4. Calculate candidate SLO/error budget from the approved baseline and product impact. Record approver and formula in `artifacts/observability/<sha>/baseline.json`.
5. Configure warning/critical thresholds from that file; use missing data as `NO_DATA`, never success.
6. Fire a redacted synthetic failure, confirm routing to this runbook, acknowledge it, and retain alert/recovery timestamps.

Until those steps exist, fields remain `TBD_FROM_BASELINE`:

| Signal                         | Baseline | SLO | Alert window | Status                 |
| ------------------------------ | -------: | --: | ------------ | ---------------------- |
| crash-free sessions/users      |      TBD | TBD | TBD          | NO-GO evidence missing |
| API success/error and p95/p99  |      TBD | TBD | TBD          | NO-GO evidence missing |
| startup/screen-ready           |      TBD | TBD | TBD          | NO-GO evidence missing |
| Worker origin/cache/rate-limit |      TBD | TBD | TBD          | NO-GO evidence missing |
| DB pool/lock/slow query        |      TBD | TBD | TBD          | NO-GO evidence missing |
| push ticket/receipt            |      TBD | TBD | TBD          | NO-GO evidence missing |

## Triage

1. Freeze OTA/Worker/store rollout; record incident and target SHA.
2. Determine whether client, Worker, Supabase, provider or network owns the first failing span using request IDs.
3. Apply only the documented kill switch/rollback; never disable RLS/JWT/TLS/rate limits to recover availability.
4. Compare recovery against the same baseline window and device cohort.
5. Add redacted query export, alert event, owner, timestamps and rollback version/group to the same-SHA evidence package.

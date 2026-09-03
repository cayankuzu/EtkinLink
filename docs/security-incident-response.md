# Security incident response

## Severity and first response

| Severity | Example                                                              | First action                                            |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| SEV-0    | active token/signing/service-role compromise, cross-user data access | page security + incident commander; contain immediately |
| SEV-1    | exploitable auth/RLS/Worker bypass, private media leak               | freeze releases; revoke affected path                   |
| SEV-2    | bounded abuse, redaction failure without confirmed exposure          | preserve evidence; patch within approved window         |
| SEV-3    | hardening finding without exploit                                    | risk-register and scheduled remediation                 |

Use a restricted incident channel and an incident ID. Store only UTC timestamps, request IDs, hashed/test user aliases, affected release/runtime/version and redacted logs. Never paste tokens, message/report bodies, precise location, signed URLs or database dumps into tickets/chat.

## Containment order

1. Freeze EAS, Worker, Supabase migration/function and store rollouts. Preserve immutable same-SHA artifacts.
2. Identify the trust boundary: GitHub, EAS, Cloudflare, Supabase, Sentry, SMTP/provider, Android signing or Apple signing.
3. Revoke/rotate the narrowest credential first, then invalidate dependent sessions if required. Credential names are in `MANUAL_STEPS.md`; values never enter Git.
4. For data authorization issues, disable only the affected existing route via a documented kill switch or deploy a deny-by-default fix. Never disable RLS/JWT verification/TLS globally.
5. For OTA signing-key compromise, halt OTA, rotate the key/certificate and ship a new runtime in signed native binaries. Old binaries cannot trust a new certificate by OTA.
6. For Worker compromise, roll back to a known version and rotate Cloudflare token/origin HMAC. For Supabase compromise, rotate service-role/JWT/DB/provider secrets according to dependency order and verify old credentials fail.
7. Notify legal/privacy owner for exposure assessment and regulatory/user communication; engineering does not invent notification obligations.

## Push credential incident and rotation order

Treat a leaked `PUSH_WORKER_SECRET`, Expo access token, APNs key/certificate or FCM service credential as SEV-0 until provider audit proves otherwise. Never paste the old/new value, HMAC canonical body, push token or notification content into the incident channel.

1. Record incident ID, affected environment, first/last suspected UTC time, release SHA and credential **name**. Freeze push deploy/replay.
2. Stop the two exact cron jobs (`etkinlink-push-outbox-drain`, `etkinlink-push-receipts`) and temporarily disable only `notification_events_dispatch_push`. Domain writes continue accumulating durable outbox rows; do not delete them.
3. If the worker HMAC is affected, rotate Edge `PUSH_WORKER_SECRET` and Vault `push_worker_secret` as one pair. Current code accepts one active secret, so do not reopen callers between those writes. Validate new DB-generated HMAC once and require captured old/stale/scope/body/replay requests to return 401.
4. If `EXPO_ACCESS_TOKEN` is affected, replace it in both push Functions, deploy from the approved SHA and create one synthetic ticket+receipt. Verify the revoked token fails at the provider. APNs/FCM credentials are rotated in the Expo/Apple/Google console dependency order; rebuild only if entitlement/profile/native credential state requires it.
5. Re-enable the dispatch trigger and recreate/enable each cron exactly once. Observe backlog age, attempts, leases, ticket/receipt terminal states and invalid-token cleanup before draining at normal concurrency.
6. If validation fails, keep callers paused, restore the last known-good non-compromised pair or deploy a deny-by-default Function, and preserve outbox rows for recovery. Never bypass HMAC/nonce, service-role RPC ACL or receipt lease checks.

Required evidence under `artifacts/incidents/<incident-id>/push/`: redacted pre/post configuration **names**, provider revocation ID, job/trigger state, old-credential rejection, new HMAC success, synthetic ticket/receipt, backlog before/after, reviewer and exact reopening time. The normal device push matrix is rerun if APNs/FCM, project identity or native entitlement changed.

## Eradication, recovery and evidence

Reproduce with synthetic fixtures, add a regression test, run secret history scan/SAST/dependency audit/RLS tests, restore only from a verified artifact, and canary by protected environment approval. Recovery requires verified denial of the original exploit and baseline-derived health—not merely a successful deploy.

Evidence path: `artifacts/incidents/<incident-id>/`. Include timeline, owner, affected SHA/runtime/version, redacted indicators, rotated credential **names**, test outputs, rollback/deployment IDs, reviewer and post-incident actions. Hash the package with the release manifest. Access is need-to-know.

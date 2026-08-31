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

## Eradication, recovery and evidence

Reproduce with synthetic fixtures, add a regression test, run secret history scan/SAST/dependency audit/RLS tests, restore only from a verified artifact, and canary by protected environment approval. Recovery requires verified denial of the original exploit and baseline-derived health—not merely a successful deploy.

Evidence path: `artifacts/incidents/<incident-id>/`. Include timeline, owner, affected SHA/runtime/version, redacted indicators, rotated credential **names**, test outputs, rollback/deployment IDs, reviewer and post-incident actions. Hash the package with the release manifest. Access is need-to-know.

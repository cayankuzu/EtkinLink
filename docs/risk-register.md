# AAA-MVP release risk register

| ID   | Risk/blast radius                               | Repository control                                           | Missing proof/exit                               | Owner            | Decision   |
| ---- | ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ---------------- | ---------- |
| R-01 | OTA mismatch/tampering affects updated clients  | fail-closed classifier, isolated workflows, rollback runbook | signed OTA AAB+IPA; signature and rollback tests | Mobile/Security  | P0 NO-GO   |
| R-02 | Signed URL/snapshot leaks across sessions       | snapshot sanitization and logout purge tests                 | two-account/process-kill device test             | Mobile/Security  | P0 NO-GO   |
| R-03 | RLS/Realtime lets left/blocked users read       | joined-only policies, explicit ACL revokes, local pgTAP      | staging A/B/blocked/realtime test                 | Backend/Security | P0 NO-GO   |
| R-04 | Ingestion SSRF/partial failure corrupts catalog | fixed HTTPS upstream, bounded HTTP, atomic batch RPC/tests    | staging fault injection/catalog survival         | Backend          | P0 NO-GO   |
| R-05 | Worker auth/cache/rate error leaks or blocks    | selective Worker tests/dry-run                               | preview abuse/contracts + gradual rollback       | Edge/Security    | P0 NO-GO   |
| R-06 | Offline replay duplicates/leaks owner data      | owner purge, idempotency, max attempts and dead-letter state | 24-hour/process-kill/reconnect device test        | Mobile/Backend   | P1 open    |
| R-07 | Recovery misses business objective              | isolated restore runbook                                     | timed restore + approved measured RPO/RTO        | Database         | P0 NO-GO   |
| R-08 | Monitoring threshold is invented/PII-bearing    | redaction + baseline procedure                               | real baseline, alert drill, PII canary           | Observability    | P0 NO-GO   |
| R-09 | Evidence combines different SHAs                | run validation + checksum manifest                           | all gates one clean SHA                          | Release          | P0 NO-GO   |
| R-10 | Moderation cannot be safely operated at scale   | audited service-role RPC, immutable events, no-panel runbook | staging operator/appeal/sanction drill            | Trust & Safety   | P1 open    |
| R-11 | Store forms/binary differ from repo             | privacy inventory/artifact guards                            | internal tracks + form exports + hashes          | Compliance       | P0 NO-GO   |
| R-12 | Dependency/static finding regresses             | lock/audit/gitleaks/SAST CI                                  | same-SHA scans, expiring exceptions              | Security         | P1 pending |

Risk acceptance cannot turn missing P0 privacy/RLS, signed artifact, rollback or restore evidence into GO. Accepted P1 risk needs approver, expiry, compensating control and evidence path.

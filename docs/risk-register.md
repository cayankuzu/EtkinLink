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

## Time-bounded dependency exceptions

`npm audit --omit=dev` reports 9 moderate findings and 0 high/critical, so the production audit policy passes. Each one is recorded here with its exploitability, compensating control and expiry; an exception that reaches its expiry without a re-review is a release blocker.

| ID | Advisory | Path | Reaches the shipped bundle? | Exploitability here | Compensating control | Owner | Expiry |
| -- | -------- | ---- | --------------------------- | ------------------- | -------------------- | ----- | ------ |
| D-01 | GHSA-vcc3-ghjq-m6fr — `decode-uri-component` denial of service via exponential decoding of malformed percent-encoded input | `@react-navigation/native` → `@react-navigation/core` → `query-string` → `decode-uri-component` | **Yes** | Any app or web page on the device can open an `etkinlink://` URL. Impact is a JS-thread hang of this app only; no data disclosure. No fixed release exists (`fixAvailable: false`, affected range `<=0.4.2`), so the dependency cannot be upgraded out of it | `sanitizeDeepLinkPath` drops the query and fragment, rejects incomplete percent sequences and bounds the path to 512 characters before React Navigation parses it (`mobile/src/app/navigation/deepLinkPath.ts`, 10 unit tests). The single configured route takes no query parameters | Mobile/Security | 2026-12-03 — re-check for an upstream fix or a react-navigation bump |
| D-02 | `@xmldom/xmldom` XML fragment injection | `expo-splash-screen` → `@expo/config-plugins` → `xcode` → `simple-plist` → `plist`; and `expo-updates` → `@expo/plist` | No | Build-time prebuild/plist tooling only. Never evaluated on device and never fed attacker-controlled XML: inputs are this repository's own committed native config | Fixed by an upstream Expo SDK bump; tracked with the SDK upgrade cadence | Mobile | 2026-12-03 — re-check on the next Expo SDK release |
| D-03 | `qs` array-limit bypass and DoS via attacker-controlled `isBuffer` | `react-native` → `@react-native/community-cli-plugin` → `@react-native-community/cli` → `@react-native-community/cli-server-api` → `body-parser` → `qs` | No | Metro development server only. Not present in a release build and never exposed to untrusted networks | Fixed by an upstream React Native CLI bump | Mobile | 2026-12-03 — re-check on the next React Native patch |

Re-run `npm audit --omit=dev --json` on the release SHA before signing off; a new high or critical finding, or a new moderate finding that reaches the shipped bundle, fails `npm run audit:production` and blocks the release.

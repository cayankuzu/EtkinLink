# Manual production steps (all currently incomplete)

These steps mutate external systems and were not executed by this repository change. Perform them in order against the exact approved commit SHA. Redact every secret value and attach the artifact/checksum under the stated path. Completion requires owner, UTC time and evidence review.

## 1. Protect GitHub environments and branch

- [ ] **Why/where:** prevent unreviewed production deploys; GitHub Settings → Environments/Branches.
- **Fields:** environments `development`, `preview`, `production`; production required reviewers, prevent self-review, protected `main`/signed tags only. Require mobile CI, DB/edge/security and feature-freeze checks on `main`.
- **Secrets/vars:** preview `EXPO_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and public variables `EDGE_API_BASE_URL`, `ORIGIN_BASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWKS_URL`, `ALLOWED_ORIGINS`, `PREVIEW_SUPABASE_PROJECT_REF`, `PRODUCTION_SUPABASE_PROJECT_REF`; production uses separate credentials/URLs plus the same two public project identities and signing/Sentry/Supabase secrets. Production environment vars must also define the approved public identities `ANDROID_SIGNING_CERT_SHA256` and `IOS_SIGNING_TEAM_ID`; missing values fail before a native build. A future production OTA private key may be provisioned only after the trust design is approved; the currently blocked workflows neither request nor read one, and no production key may exist in preview. The two 20-character project refs must be distinct. Edge URL must be a bare HTTPS origin matching the signed binary's native build-time value. Worker origin/JWT/JWKS values must use the exact `/functions/v1`, `/auth/v1` and JWKS paths on that environment's declared project; never point preview at production.
- **Verify:** `gh api repos/cayankuzu/EtkinLink/environments/production` and `gh api repos/cayankuzu/EtkinLink/branches/main/protection` show reviewers/protection without secret values.
- **Rollback:** disable deploy workflows first; change protection only with repository-owner approval.
- **Owner/evidence:** Release owner; `artifacts/manual/github/<sha>/`.

## 2. Create Cloudflare scope, zone, token and stable host

- [ ] **Why/where:** isolate edge protection and stable API DNS; Cloudflare Account/API Tokens and Zone/DNS.
- **Fields:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `ROOT_DOMAIN`, preview hostname, `api.<ROOT_DOMAIN>`. Separate custom tokens `etkinlink-preview-deploy`/`etkinlink-production-deploy`, scoped to the selected account/zone and only required Worker Script/Route permissions.
- **Verify:** `npx wrangler@4.127.1 whoami`; `Resolve-DnsName api.<ROOT_DOMAIN>`; after deploy request `GET https://api.<ROOT_DOMAIN>/v1/catalog` without a token and require the documented `401` JSON/no-store response, then repeat with an approved synthetic JWT and require the strict catalog contract. No undocumented health/product route is added. Output contains no secret/config values.
- **Rollback:** remove Worker route/custom domain, restore prior DNS, revoke token.
- **Owner/evidence:** Edge owner; `artifacts/manual/cloudflare/<sha>/account-zone-dns-redacted.json`.

## 3. Configure Worker bindings, secrets, WAF and rate limits

- [ ] **Why/where:** enable the selected gateway without leaking origin credentials; Worker Settings/Bindings/Variables and Security/WAF.
- **Fields:** separate preview/production secrets named by `infra/cloudflare/etkinlink-edge/.dev.vars.example`, public GitHub Environment variables `ORIGIN_BASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE=authenticated`, `JWKS_URL`, `ALLOWED_ORIGINS`, both `PREVIEW_SUPABASE_PROJECT_REF` and `PRODUCTION_SUPABASE_PROJECT_REF`, and distinct rate-limit bindings. Define the two project refs consistently in both protected environments; the workflow selects the expected ref and rejects the other. Committed `.invalid` origin values are deliberate fail-closed dry-run placeholders and must never be deployed as runtime configuration. Do not add Supabase service-role unless the implemented route contract explicitly needs it.
- **Commands:** `cd infra/cloudflare/etkinlink-edge`; `npx wrangler secret put <SECRET_NAME> --env preview`; repeat with production under approved access; `npx wrangler secret list --env <ENV>` (names only); `npm ci; npm run check; npm run dry-run`.
- **Verify:** method/body/schema/JWT/cache/no-store/rate/HMAC/replay matrix, preview smoke and log redaction. Native requests without `Origin` work; browser CORS is exact allowlist.
- **Rollback:** `npx wrangler rollback --env production`; revoke token/HMAC on suspected exposure.
- **Owner/evidence:** Edge/Security; `artifacts/manual/cloudflare/<sha>/bindings-waf-rate-limit/`.

## 4. Configure Supabase secrets and schedulers

- [ ] **Why/where:** preserve Supabase source of truth and authenticate internal ingestion; staging Dashboard/CLI first.
- **Fields:** `SUPABASE_URL`, publishable key, service-role key (server only), DB URL, fixed upstream URL, origin HMAC/current+previous key if implemented, cron secret; Vault `edge_functions_base_url`, `account_deletion_worker_secret`, `push_worker_secret`; Edge secrets `ACCOUNT_DELETION_WORKER_SECRET`, `PUSH_WORKER_SECRET`, `EXPO_ACCESS_TOKEN`. Account-deletion and push worker secrets must be distinct; staging/production push values must also be distinct. Use exact names from function code; do not invent aliases.
- **Commands:** `npx supabase@2.116.0 link --project-ref <STAGING_PROJECT_REF>`; `npx supabase@2.116.0 secrets set <NAME>` from protected CI; `npx supabase@2.116.0 secrets list` (names only).
- **Verify:** staging functions/migrations; valid internal call once; replay/invalid HMAC denied. Confirm exactly one production ingestion scheduler, one `etkinlink-account-deletion-continuations`, one `etkinlink-push-outbox-drain` and one `etkinlink-push-receipts` scheduler. For push, prove exact existing notification kinds including `blocked/unblocked`, event max-attempt terminal state, unique two-minute receipt lease, stale lease rejection, transient provider attempt/backoff, fifth-attempt logical DLQ, PII-safe terminal query/replay and atomic invalid-token cleanup. Prove that an `auth_deleted` fixture completes after the user JWT is no longer usable and that terminal rows are visible only through the service-only RPC.
- **Push rotation commands:** use protected SQL access to unschedule the two exact push job IDs and `alter table public.notification_events disable trigger notification_events_dispatch_push`; rotate Function `PUSH_WORKER_SECRET`, then Vault `push_worker_secret`; validate new DB-generated HMAC and old-secret rejection; `alter table ... enable trigger ...`; recreate the two schedules from the reviewed migration definitions and require one row per exact job name. Never print a secret or hand-build a valid signature in shell history.
- **Rollback:** while push callers remain paused, restore the prior non-compromised Function/Vault secret pair or prior compatible Function, validate it, then enable trigger/jobs exactly once. Outbox rows and attempt counters are not deleted or reset; never reset production DB.
- **Owner/evidence:** Backend; `artifacts/manual/supabase/<sha>/`.

## 5. Verify EAS project, channels and environments

- [ ] **Why/where:** isolate OTA/native builds; Expo dashboard and EAS CLI.
- **Fields:** owner `cayann`, slug `etkinlink`, project ID from resolved `mobile/app.json`; explicit runtime `1.0.9`; `development`, `preview`, `production` channels/environments; distinct project-scoped tokens; optional bare HTTPS `EDGE_API_BASE_URL` matching that environment's signed binary.
- **Commands:** `cd mobile`; set protected `EXPO_TOKEN`; `npx eas-cli@21.0.0 project:info`; `npx eas-cli@21.0.0 channel:list`; `npx expo config --type public --json`.
- **Verify:** owner/slug/project ID/update URL/runtime/channel match native artifacts; public config contains no secret.
- **Rollback:** unlink wrong channel/branch; revoke wrong token; never change package/bundle/project identity.
- **Owner/evidence:** Mobile release; `artifacts/manual/eas/<sha>/`.

## 6. Configure OTA code signing and rebuild both platforms

- [ ] **Why/where:** reject tampered updates; offline key workstation and protected production secret store. Confirm plan availability before relying on signing.
- **Commands:** `npx expo-updates codesigning:generate --key-output-directory <OUTSIDE_REPO_KEYS> --certificate-output-directory mobile/certs --certificate-validity-duration-years <APPROVED_YEARS> --certificate-common-name "EtkinLink"`; then `npx expo-updates codesigning:configure --certificate-input-directory mobile/certs --key-input-directory <OUTSIDE_REPO_KEYS>`.
- **Fields:** public certificate/key ID/algorithm in app/native config; private keys never enter Git/artifacts. Design a distinct, reviewed preview trust/key boundary; never copy or expose the production private key to preview merely to pass a test.
- **Current blocker:** `eas-update-preview.yml` and `eas-update-production.yml` run verification/classification only, contain no EAS mutation command and intentionally fail before publication. Do not remove a blocker until the trust/key custody design, same-SHA signed native artifacts, two-platform valid/invalid-signature tests and rollback evidence satisfy `ota-runtime-and-release.md`.
- **Verify:** new-runtime AAB/IPA embed certificate/runtime/update URL; signed fixture applies and invalid signature is rejected on both devices.
- **Rollback:** halt OTA; retain old key for old runtime; rotate certificate/key and ship another native runtime.
- **Owner/evidence:** Security/Mobile; `artifacts/manual/ota-signing/<sha>/`.

## 7. Configure Android/iOS signing

- [ ] **Fields:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; protected production var `ANDROID_SIGNING_CERT_SHA256` as exactly 64 uppercase hexadecimal characters without separators (the CI AAB/upload signer certificate, not the Play App Signing certificate); EAS/Apple distribution, provisioning and APNs credentials; protected production var `IOS_SIGNING_TEAM_ID` as exactly 10 uppercase alphanumeric characters; no committed key file.
- **Commands:** create/use a protected tag resolving to `<FULL_SHA>`, then `gh workflow run mobile-release.yml --ref <PROTECTED_TAG_AT_FULL_SHA> -f target_sha=<FULL_SHA>`; verify the run `head_sha`, download artifacts; `jarsigner -verify -strict <AAB>`; on macOS `codesign --verify --deep --strict <APP>` and inspect entitlements. (`gh workflow run --ref` accepts a branch/tag, not a raw SHA.)
- **Verify:** `jarsigner` and `keytool -printcert -jarfile` succeed, extracted AAB signer fingerprint exactly equals `ANDROID_SIGNING_CERT_SHA256`; iOS `codesign` TeamIdentifier and signed `com.apple.developer.team-identifier` both exactly equal `IOS_SIGNING_TEAM_ID`, while `application-identifier` is `<TEAM_ID>.com.etkinlink.app`. AAB/IPA, signer-identity JSON, R8 mapping, dSYM/native symbols/source maps, privacy manifest, production push entitlement and hashes all bind to the same SHA. Missing/malformed expected identities or any mismatch is release **NO-GO**.
- **Rollback:** follow store credential rotation; retain prior approved store artifact.
- **Owner/evidence:** Mobile release; `artifacts/release/<sha>/android/` and `ios/`.

## 8. Configure Sentry release and alerts

- [ ] **Fields:** distinct staging/production `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, alert target type/ID; least-privilege token.
- **Commands:** `gh workflow run configure-monitoring.yml --ref <PROTECTED_TAG_AT_FULL_SHA>`; verify run `head_sha`, then perform signed-build source-map verification.
- **Verify:** redacted PII canary, source maps, release/dist/runtime/channel tags; baseline-derived alert fires and recovers. Missing data is `NO_DATA`, not PASS.
- **Rollback:** disable bad detector/DSN, revoke token, retain incident evidence.
- **Owner/evidence:** Observability; `artifacts/monitoring/<sha>/`.

## 9. Configure existing external providers

- [ ] **Fields:** dedicated SMTP sender/domain credentials, APNs/FCM/Expo push credentials, fixed event-upstream credential if needed; DKIM/DMARC domain, no personal Gmail.
- **Verify:** synthetic credential tests; invalid credential fails closed; tokens/message bodies absent from logs.
- **Rollback:** revoke credential, disable adapter/scheduler, preserve current catalog and Supabase core paths.
- **Owner/evidence:** Backend/Mobile; `artifacts/manual/providers/<sha>/`.

## 10. Deploy isolated staging

- [ ] **Commands:** link only `<STAGING_PROJECT_REF>`; `npx supabase@2.116.0 db push --linked --dry-run`; review then `db push --linked`; deploy functions by exact repository list; dispatch the preview Worker workflow with the same SHA. The preview OTA workflow may be run only as a validation exercise with the successful same-SHA `mobile-ci.yml` run ID and is expected to stop at its publication blocker.
- **Verify:** staging ref/host, forward-only migrations, RLS/lint/contracts, feature-freeze and log redaction pass. An OTA `OTA_SAFE` classification is not deployment evidence.
- **Rollback:** independently restore Function/Worker/OTA versions; database only via forward corrective migration.
- **Owner/evidence:** Release/Backend/Edge; `artifacts/staging/<sha>/`.

## 11. Run E2E and staged load

- [ ] **Commands:** `gh workflow run mobile-e2e.yml --ref <PROTECTED_TAG_AT_FULL_SHA> -f target_sha=<FULL_SHA>`; verify run `head_sha`; then `gh workflow run staging-load-test.yml --ref <PROTECTED_TAG_AT_FULL_SHA> -f target_sha=<FULL_SHA> -f confirmation=staging-10k -f target_vus=10000` only after 25/250 gates.
- **Verify:** both E2E jobs, offline exactly-once replay, 25→250→target thresholds and cleanup pass against isolated staging. Another SHA is rejected.
- **Rollback:** stop load, revoke fixture JWTs, clean only labeled synthetic data.
- **Owner/evidence:** QA/Performance; `artifacts/e2e/<sha>/`, `artifacts/load/<sha>/`.

## 12. Run physical-device/accessibility/push matrix

- [ ] **Fields:** model/OS/build hash/runtime/channel/network/font scale/screen reader and synthetic account alias per `device-matrix.md`.
- **Commands:** Android `adb devices -l`, install signed staging artifact, font scale 1.0/2.0, bugreport; iOS Xcode Devices/Console + sysdiagnose. Test foreground/background/terminated, rotation/reinstall push.
- **Verify:** existing flows, offline restart, VoiceOver/TalkBack, invalid OTA signature and rollback on both platforms.
- **Rollback:** reinstall known-good signed build; revoke synthetic push tokens.
- **Owner/evidence:** QA/Accessibility; `artifacts/device-matrix/<sha>/`.

## 13. Execute backup/PITR restore drill

- [ ] Follow `backup-restore-runbook.md` with isolated `RESTORE_DATABASE_URL`; record provider backup/PITR status, checksum, migration SHA, measured recoverable point and elapsed time.
- **Verify:** RLS/pgTAP/invariants and aggregate counts; cron/email/push disabled. Approve RPO/RTO only from measurements.
- **Rollback:** destroy disposable target after review; revoke temporary credentials; never reset production.
- **Owner/evidence:** Database on-call; `artifacts/restore/<sha>/`.

## 14. Complete TestFlight/Internal Track and privacy/UGC forms

- [ ] **Fields:** signed artifact hashes; privacy/Data Safety, deletion URL, UGC report/block, ratings, support/privacy URLs, review notes/screenshots.
- **Verify:** uploaded hash equals CI; internal tests pass; forms match `privacy-data-inventory.md`; no pre-launch blocker.
- **Rollback:** halt phased rollout/remove test release as supported; keep prior version available.
- **Owner/evidence:** Compliance/Release; `artifacts/store/<sha>/`.

## 15. Approve canary, rollback drills and manifest

- [ ] Review every path above. Do not dispatch production OTA as a release action: both OTA workflows are mechanically blocked until isolated signing trust, same-SHA native artifacts, two-platform signature/rollback proof and a reviewed publish implementation exist. Cloudflare production is separately blocked until an explicit baseline version ID and idempotent reuse of one uploaded target version across widening are implemented and runtime-tested.
- **Manual bundle:** create a published, non-prerelease GitHub Release whose protected tag resolves to the exact target SHA. Attach `manual-release-evidence.zip` with any completed gate directories named `real_devices_and_push`, `ota_preview_rollback`, `cloudflare_preview_rollback`, `backup_restore`, `monitoring_slo` and `store_console`. Each directory must contain `attestation.json` plus the regular files it names; do not include secrets or symlinks.
- **Attestation fields:** `schemaVersion: 1`, exact `gateId`, full lowercase `targetSha`, `decision: "approved"`, non-empty reviewer, ISO-8601 `reviewedAt`, and a non-empty `evidenceFiles` array of paths relative to that gate directory.
- **Manifest:** dispatch `release-evidence.yml` with only same-SHA workflow run IDs plus `manual_evidence_release_tag` and the exact ZIP asset name.
- **Verify:** manifest has a clean source tree and every required gate `verified`; checksums match; observation window passes. A reference string alone is not evidence. Missing attestations remain missing, while malformed or tampered attestations fail the workflow.
- **Rollback:** stop canary, `wrangler rollback --env production`, follow `ota-rollback-runbook.md`, halt store rollout.
- **Owner/evidence:** Incident commander/Release; `artifacts/release-evidence/<sha>/`.

Current status: all boxes are open; release is **NO-GO**.

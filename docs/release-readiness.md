# Release readiness — immutable evidence gate

## Current decision

Repository implementation and local/static tests are not a production release. No current package binds signed Android/iOS artifacts, staging E2E/load, physical devices/push/accessibility, OTA/Worker rollback, restore drill, monitoring alarms and store forms to one immutable SHA. Decision: **NO-GO**.

`IMPLEMENTATION COMPLETE, RELEASE NO-GO UNTIL LISTED MANUAL/RUNTIME EVIDENCE IS ATTACHED TO THE SAME COMMIT SHA.`

That sentence is the intended final handoff condition; “implementation complete” is valid only after every repository test passes.

## Automated repository gates

| Gate           | Workflow/command                                       | Required                                                                       | Current release evidence              |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| feature freeze | `node scripts/guards/check-no-new-product-surface.mjs` | no new product surface                                                         | same-SHA CI artifact pending          |
| mobile         | `mobile-ci.yml`                                        | type/lint/format/architecture/deadcode/security/performance/release/Jest/audit | same-SHA run pending                  |
| DB/RLS         | mobile CI database job                                 | start, lint fail-on-warning, pgTAP                                             | CI/staging run pending                |
| Edge Functions | Deno job                                               | format/check/test                                                              | same-SHA run pending                  |
| supply chain   | gitleaks/SBOM/audit                                    | no unapproved finding                                                          | same-SHA artifact pending             |
| Worker         | `npm run check` + dry-run                              | Worker tests/types/lint/format                                                 | same-SHA run pending                  |
| OTA            | classifier tests + `--assert-ota-safe`                 | exactly `OTA_SAFE`; publication still blocked pending trust/native proof       | mechanically blocked, validation only |

## External/runtime gates

| Gate              | PASS evidence                                                                                   | Status  |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------- |
| signed artifacts  | strict AAB/mapping + exact Android cert fingerprint; IPA + exact Team ID/entitlements, same SHA | MISSING |
| staging E2E/load  | backend + mobile/offline and staged load, same SHA                                              | MISSING |
| real devices/push | required matrix, VoiceOver/TalkBack and push lifecycle                                          | MISSING |
| OTA               | OTA-enabled binaries, valid/invalid signature, old binary, embedded offline and rollback        | MISSING |
| Cloudflare        | preview abuse/cache contracts, gradual deploy and rollback                                      | MISSING |
| restore           | isolated restore with measured RPO/RTO and RLS                                                  | MISSING |
| observability     | baseline SLO, fired/recovered alert and PII canary                                              | MISSING |
| store/privacy     | TestFlight/Internal Track + reviewed forms and matching hash                                    | MISSING |

## Immutable manifest

`release-evidence.yml` checks out an explicit full SHA contained in `origin/main`, accepts only successful workflow runs whose `head_sha` equals it, downloads artifacts, and generates SHA-256 metadata. Reviewed manual proof is accepted only from a published, non-prerelease GitHub Release whose protected tag resolves to that exact SHA. Missing proof remains `missing`; attached but unreviewed proof is not promoted to verified. Dirty tree or any required gate below `verified` yields `NO-GO`.

```powershell
gh workflow run release-evidence.yml --ref main `
  -f target_sha=<FULL_SHA> `
  -f mobile_ci_run_id=<SAME_SHA_RUN> `
  -f staging_e2e_run_id=<SAME_SHA_RUN> `
  -f staging_load_run_id=<SAME_SHA_RUN> `
  -f mobile_release_run_id=<SAME_SHA_RUN> `
  -f ota_production_run_id=<SAME_SHA_RUN> `
  -f cloudflare_production_run_id=<SAME_SHA_RUN> `
  -f manual_evidence_release_tag=<PROTECTED_SAME_SHA_TAG> `
  -f manual_evidence_asset_name=manual-release-evidence.zip
```

Automated artifacts cannot verify physical devices, store forms, restore or provider dashboards. Follow `MANUAL_STEPS.md`; place each reviewed gate under its exact gate ID in `manual-release-evidence.zip`, with an approved `attestation.json` and only the regular evidence files it names. The workflow rejects a wrong SHA, unsafe path, symlink, malformed attestation or missing file.

## Rollback ownership

- Mobile/store: stop phased rollout and restore prior approved binary.
- OTA: republish known-good same-runtime group.
- Worker: reduce gradual percentage or `wrangler rollback`.
- Supabase Function: deploy prior compatible function.
- Database: forward corrective migration only; restore into isolation before recovery.

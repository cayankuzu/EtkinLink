# Backup and restore runbook

## Safety and objectives

Supabase is the source of truth. Production is never reset. Restore drills use a new isolated project/database with outbound notifications, cron and external webhooks disabled. RPO and RTO are `TBD_FROM_BASELINE`; they become objectives only after a successful timed drill and owner approval.

## Backup capture

Owner: database on-call. Evidence root: `artifacts/restore/<utc-date>-<source-sha>/`.

1. Record source project ref, region, migration SHA, PostgreSQL version, backup/PITR dashboard status and UTC start. Do not record passwords.
2. Export secrets from the secret manager inventory by **name only**; secrets are restored separately and never placed in the artifact.
3. From a clean checkout at the migration SHA:

```powershell
npx supabase@2.116.0 link --project-ref <SOURCE_PROJECT_REF>
npx supabase@2.116.0 db dump --linked -f artifacts/restore/<DRILL>/schema.sql
npx supabase@2.116.0 db dump --linked --data-only --use-copy `
  -f artifacts/restore/<DRILL>/data.sql
Get-FileHash artifacts/restore/<DRILL>/*.sql -Algorithm SHA256 `
  | Format-Table -HideTableHeaders > artifacts/restore/<DRILL>/SHA256SUMS.txt
```

Use an approved read-only/backup database credential. Store encrypted dumps in the approved restricted backup location; repository artifacts should contain only redacted metadata/checksums unless access controls explicitly permit dumps.

## Isolated restore drill

1. Create a disposable restore project. Set `RESTORE_DATABASE_URL` from the protected secret store; verify its project ref is not production.
2. Disable cron, push dispatch, SMTP/webhooks and event ingestion in the restore target.
3. Restore with fail-fast transactions:

```powershell
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 `
  -f artifacts/restore/<DRILL>/schema.sql
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 `
  -f artifacts/restore/<DRILL>/data.sql
npx supabase@2.116.0 db lint --db-url "$env:RESTORE_DATABASE_URL" `
  --schema public --level warning --fail-on warning
```

4. Run pgTAP/RLS with anon, user A, user B, blocked and service-role fixtures. Compare row counts/checksums for critical tables using aggregate counts only; do not export message/profile contents.
5. Validate private Storage object counts and access denial with dedicated fixtures. Validate Auth linkage and account deletion in the disposable project.
6. Record UTC finish, last recoverable transaction timestamp, measured data-loss interval and elapsed restore time. These measurements become the baseline; do not retroactively invent targets.
7. Delete the disposable project only after evidence review, using the provider's protected deletion workflow. Production is not changed.

## Failure/rollback

Stop on target mismatch, checksum mismatch, migration/lint/RLS failure, outbound side effect, missing encryption or missing audit trail. Revoke the temporary credential, quarantine artifacts and open a security incident if user data left the approved boundary. A dump command exit zero without application/RLS validation is not a successful restore drill.

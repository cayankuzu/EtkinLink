# OTA rollback runbook

> Current repository state: preview and production OTA workflows contain no EAS publication command and intentionally fail at a mechanical blocker. This runbook becomes operational only after the signing trust design, same-SHA native evidence and reviewed publish implementation satisfy `ota-runtime-and-release.md`; it is not permission to bypass that blocker manually.

## Trigger and authority

Stop rollout on any crash/error/startup regression beyond the approved baseline envelope, failed signature, login/event/chat regression, data-contract incompatibility, or broken edge URL. Incident commander owns the decision; production environment reviewers authorize EAS mutations. Never change native runtime compatibility to make a bad update install.

## Immediate containment

1. Record `target SHA`, `runtimeVersion`, channel, update group IDs, rollout percentage, UTC start and incident ID without PII.
2. Stop widening the rollout. Preserve Sentry/EAS logs and the production workflow artifact.
3. Select a previously healthy group on the **same runtimeVersion**. Validate its SHA and artifact checksum from the prior release manifest.
4. From a clean checkout of that healthy commit, use the production-only key outside the repository:

```powershell
cd mobile
$env:EXPO_TOKEN = '<FROM_PROTECTED_SECRET_STORE>'
npx eas-cli@21.0.0 update:republish --group <KNOWN_GOOD_GROUP_ID> --non-interactive
```

If code signing is configured and the CLI requests the key, add `--private-key-path <PATH_OUTSIDE_REPOSITORY>`. Do not copy the key into the repository or artifacts. Confirm the command targets the production branch/channel before approval.

5. Force-close and reopen signed Android/iOS production builds twice. Verify the known-good update group applies; verify embedded startup with networking disabled.
6. Watch the baseline-derived recovery signals for the documented observation window. A successful CLI command is not recovery proof.

## Broken edge endpoint

If an OTA introduced an invalid `EDGE_API_BASE_URL` or request contract, republish the last same-runtime update whose mobile transport is known healthy. Do not edit Android resources, Info/Expo plist, certificate or runtime through OTA. If the embedded binary cannot reach a safe origin, halt OTA and issue a native build; do not silently bypass authentication or TLS.

## Native/runtime mismatch

An update built for a different native dependency/configuration must be withdrawn, not reclassified. Restore the last compatible update, increment app/runtime version, build signed AAB/IPA, test preview/internal tracks, then resume. An OTA cannot repair missing native `expo-updates` metadata or a missing/expired code-signing certificate.

## Evidence and closeout

Store under `artifacts/ota-rollback/<incident-id>/`: before/after EAS group metadata, commands with tokens redacted, device videos/logs, runtime/channel values, Sentry recovery query, timestamps, approver and SHA-256 checksums. Close only when both platforms recover and the manifest binds the drill to the same SHA. Rotate the private signing key and rebuild with a new runtime if key compromise is suspected.

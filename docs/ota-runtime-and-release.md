# OTA runtime and release contract

## Safety boundary

EAS Update may change only JavaScript/TypeScript and assets already understood by the installed binary. Any change under `mobile/android/`, `mobile/ios/`, Expo/native configuration, dependencies, permissions, entitlements, certificates, config plugins or environment schema requires a newly signed AAB and IPA. `mobile/scripts/classify-update.mjs` is fail-closed: `OTA_SAFE` is necessary but never sufficient to publish; `NATIVE_BUILD_REQUIRED` and `MANUAL_REVIEW_REQUIRED` must stop the flow.

`EDGE_API_BASE_URL` is an optional **native build-time** `react-native-config` value and must be a bare HTTPS origin (for example `https://api.example.com`, with no path/query/credentials). It may differ between preview and production only because their signed binaries are built separately. OTA must not change it; changing or first enabling it requires a new native baseline. The EAS workflows validate the environment-scoped GitHub variable but do not treat it as an OTA feature flag.

The runtime source of truth is the resolved Expo configuration, not a hand-written release note:

```powershell
cd mobile
npx expo config --type public --json > ../artifacts/ota/expo-config.json
npm run ota:classifier:test
$base = '<FULL_40_CHAR_NATIVE_BASELINE_SHA>'
$head = '<FULL_40_CHAR_TARGET_SHA>'
node scripts/classify-update.mjs --base $base --head $head --assert-ota-safe
```

The app version/runtime, EAS project ID, update URL and Android/iOS native metadata must agree. Changing runtime policy or the code-signing certificate is a native change and requires new store binaries.

## Environment isolation

| Environment | EAS channel   | GitHub Environment                   | Credential policy                                                           | Current purpose                |
| ----------- | ------------- | ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------ |
| development | `development` | `development`                        | developer-scoped                                                            | local/dev client only          |
| preview     | `preview`     | `preview`                            | no production signing key; preview trust/key design is not configured       | validation only; publish block |
| production  | `production`  | `production` with required reviewers | production key remains outside repo and is not read by the blocked workflow | validation only; publish block |

Tokens and private keys must never be shared between preview and production. In particular, do not copy the production update-signing key into the preview environment merely to make a signed preview update install. The repository currently contains no EAS publish/channel-mutation command in either OTA workflow and neither workflow reads a private signing key. A reviewed preview trust boundary must be designed first; the matching public certificate must then be embedded and verified in that environment's native binaries. The production public certificate and metadata must independently match the same-SHA production AAB/IPA.

## Current validation-only sequence

1. Merge a clean target commit; record full target SHA and the last signed native baseline SHA.
2. Run all quality, DB, Worker and feature-freeze jobs at the target SHA.
3. Dispatch `eas-update-preview.yml` with `target_sha`, `base_sha` and the same-SHA mobile CI run. It re-runs mobile verification and requires `OTA_SAFE`, then intentionally fails at the publication blocker. It does not call EAS or mutate a channel.
4. Design and review an isolated preview signing trust boundary. Generate/hold its private key outside Git/artifacts, embed only its public certificate in signed preview Android/iOS binaries, and prove valid-signature acceptance plus invalid-signature rejection on both platforms. Reusing or exposing the production private key is forbidden.
5. Configure the production public certificate/metadata in Expo, Android and iOS, increment the native runtime as required, and obtain successful same-SHA code-signing-aware AAB and IPA artifacts from `mobile-release.yml`.
6. Keep `eas-update-production.yml` blocked until a future reviewed preview publish path can produce exact-SHA runtime evidence and the production workflow can validate that preview run, same-SHA native artifacts, signing evidence and rollback proof. The current workflow contains no publish command.
7. Only after the blockers are replaced by a reviewed implementation may a bounded rollout begin. Observe baseline-derived crash, startup and API signals; do not infer health from command success.

The preview dispatch below is a validation exercise and is expected to end at the explicit blocker:

```powershell
gh workflow run eas-update-preview.yml --ref main `
  -f target_sha=<FULL_SHA> -f base_sha=<FULL_NATIVE_BASELINE_SHA> `
  -f mobile_ci_run_id=<SAME_SHA_SUCCESSFUL_MOBILE_CI_RUN>
```

Do not dispatch production as a release action. Its acknowledgement value is deliberately `ACKNOWLEDGE_OTA_PUBLICATION_BLOCKED`; even if all prerequisite checks become reachable, the final step fails and no EAS mutation exists.

## Blocker removal requirements

- Security review approves distinct preview/production trust and private-key custody; no key is stored in Git, logs or artifacts and the production key is never available to preview.
- Expo config plus Android/iOS native metadata contain the exact environment certificate, `keyid` and `rsa-v1_5-sha256` metadata; certificates are current RSA 2048-bit or stronger.
- New signed native binaries at the target SHA prove embedded startup, signed update acceptance, invalid/unsigned update rejection, offline restart and rollback on both platforms.
- A successful same-SHA native release run exposes non-expired AAB and IPA evidence; preview evidence names SHA, runtime, channel and update group.
- A reviewed implementation adds pinned EAS publication only after those guards, records immutable metadata/checksums, keeps production environment approval and proves staged rollout/rollback. Removing only the `exit 1` blocker is not an acceptable implementation.

## Current status

Repository wiring is not runtime proof. Both OTA workflows are mechanically blocked and contain no EAS publish/channel mutation command; production additionally requires exact public certificate/native metadata and same-SHA native artifacts. Until the trust design and all blocker-removal evidence above are reviewed, OTA release status is **NO-GO**.

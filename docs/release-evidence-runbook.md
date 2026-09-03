# Release evidence runbook

> Bu operasyon rehberi [release-readiness.md](release-readiness.md) kararı ve `release-evidence.yml` aynı-SHA manifestiyle birlikte uygulanır. Bu belgedeki geçmiş tarih/koşu, güncel commit için PASS sayılmaz.

Bu belge yalnızca repo dışı ortam/kimlik bilgisi gerektiren kapıları tanımlar. Mock, yerel statik kontrol, eski ekran görüntüsü veya debug imzası bu kanıtların yerine geçmez. Komutlarda secret değerlerini argüman olarak veya artifact içine yazmayın.

Her koşu için commit SHA, UTC zamanı, ortam adı, workflow run URL'si ve artifact SHA-256 değeri kanıt kaydına eklenmelidir.

`gh workflow run --ref` bir branch veya tag ister; ham commit SHA güvenilir bir dispatch ref'i değildir. Manuel workflow'lar için tam hedef SHA'ya çözümlenen korumalı release tag'ini kullanın ve koşunun `head_sha` alanını hedef SHA ile karşılaştırın. `mobile-ci.yml` manuel dispatch desteklemez; hedef commit'in korumalı `main` push koşusunu seçin.

## 2026-08-31 güncel yerel doğrulama kaydı

- Repo envanteri: **55** forward migration ve beş pgTAP dosyasında sırasıyla `36 + 54 + 61 + 50 + 50 = 251` planlı kontrol.
- `npm run docker:config`, container contract paketi, `npm run docker:resilience` ve `npm run docker:load -- --vus 10 --duration 10s` yerel test/CI sınırında başarılı oldu. Yük koşusu yalnız sentetik mock hedefini kullandı.
- Yeni `docker-validation.yml`; Compose doğrulama, tekrar üretilebilir image build'i, Hadolint, HIGH/CRITICAL vulnerability kapısı, CycloneDX SBOM, provenance, canonical Supabase test profili, fault injection, bounded load, artifact checksum ve orphan cleanup işlerini fail-closed tanımlar.
- Bu kayıt linked staging migration/lint/pgTAP, tam aynı-SHA GitHub workflow sonucu, hosted provider, fiziksel cihaz, APNs/FCM, signed artifact veya mağaza kanıtı değildir. Tam `docker:test` ve aynı-SHA CI artifact'ı ayrıca başarıyla tamamlanıp bağlanmadan bu bölüm onlar için PASS sayılmaz; release kararı **NO-GO** kalır.

## 1. Staging migration, lint ve pgTAP

- Prerequisite: Production'dan ayrı Supabase staging projesi; Supabase CLI oturumu; `staging-security` GitHub environment'inda `STAGING_DATABASE_URL` ve `STAGING_PROJECT_REF`. Ref production ref'i olmamalıdır.
- Command:

  ```powershell
  npx supabase login
  npx supabase link --project-ref <staging-project-ref>
  npx supabase migration list --linked
  npx supabase db push --linked
  gh run list --workflow mobile-ci.yml --commit <full-commit-sha> --status completed
  gh run watch <same-sha-run-id> --exit-status
  ```

- Expected result: Migration history eşitlenir; `db lint --fail-on warning` temizdir; beş pgTAP dosyası sırasıyla `1..36`, `1..54`, `1..61`, `1..50` ve `1..50` planlarını, toplam 251 adet `ok` ile üretir.
- Artifact: GitHub Actions `staging-database-security-evidence/db-lint.txt` ve `staging-database-security-evidence/pgtap.txt`.
- PASS: Workflow `database-security` başarılı, lint warning/error yok, pgTAP'te `not ok` yok; beş dosyanın planları eksiksiz ve toplam kontrol sayısı 251.
- FAIL: Migration drift/push hatası, staging kimliği guard hatası, lint warning, eksik test veya herhangi bir `not ok`.

## 2. Staging Edge Function ve push zinciri

- Prerequisite: Staging Vault'ta `edge_functions_base_url` ve en az 32 karakterli `push_worker_secret`; aynı secret Edge Function environment'inda `PUSH_WORKER_SECRET`; Expo access token; staging push tokenlı test kullanıcısı.
- Command:

  ```powershell
  # .env.staging.edge dosyası PUSH_WORKER_SECRET ve EXPO_ACCESS_TOKEN içerir;
  # repo/artifact kapsamına alınmaz.
  npx supabase secrets set --env-file .env.staging.edge --project-ref <staging-project-ref>
  npx supabase functions deploy push-dispatch --project-ref <staging-project-ref>
  npx supabase functions deploy push-receipts --project-ref <staging-project-ref>

  $workerUrl = 'https://<staging-project-ref>.supabase.co/functions/v1'
  curl.exe -sS -o artifacts/staging-push-unauthorized.json -w "%{http_code}" `
    -X POST "$workerUrl/push-dispatch" -H "content-type: application/json" `
    --data '{"drain":true,"batchSize":1}'
  # Geçerli imza/timestamp/nonce yalnız staging DB helper'ı tarafından üretilir;
  # secret komut satırına taşınmaz.
  psql "$env:STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -c `
    "select private.invoke_push_worker('push-dispatch', '{\"drain\":true,\"batchSize\":1}'::jsonb);"
  ```

- Expected result: Eksik/yanlış HMAC, stale timestamp, yanlış scope/body ve replay nonce `401`; DB helper'ının tek kullanımlık imzalı boş drain çağrısı `200`; duplicate event claim `202/skipped`; gerçek olayda enqueue → claim → delivery → receipt durumları ilerler. Partial failure başarılı tokenı kaybetmez; `DeviceNotRegistered` tokenı `disabled_at` ile kapatır; geçici receipt en çok beş denemeden sonra final olur. Service-role terminal query/replay idempotent ve auditli; anon/auth çağrıları reddedilir.
- Artifact: `artifacts/staging-push-unauthorized.json`, `artifacts/staging-push-drain.json`, zaman damgalı ve test ID'sine filtrelenmiş `notification_events`/`notification_deliveries`/`push_tokens` CSV'leri, Expo receipt cevabının secretsiz özeti.
- PASS: Yetki sınırı ve tüm durum geçişleri beklenen değerlerde; aynı dedupe key için tek event/delivery; invalid token kapalı.
- FAIL: Worker anonim erişilebilir, event çift dispatch olur, pending lease takılı kalır, retry sınırsızdır veya invalid token aktif kalır.

## 3. Staging backend ve Android Maestro E2E

- Prerequisite: `staging-e2e` environment secret/variable'ları; API 34 x86_64 runner; staging seed event/room/match verileri.
- Command:

  ```powershell
  gh workflow run mobile-e2e.yml --ref <protected-tag-at-commit-sha> -f target_sha=<full-commit-sha>
  gh run watch --exit-status
  gh run download <run-id> -n android-maestro-evidence -D artifacts/e2e/android
  gh run download <run-id> -n staging-critical-backend-e2e-evidence -D artifacts/e2e/backend
  ```

- Expected result: Kayıt/login, hesap-varlığı gizliliği, etkinliğe katılma, oda/DM, matching, block/report/RLS kontrolleri; signed-out/signed-in kritik UI; offline send → reconnect → tek mesaj replay.
- Artifact: `artifacts/e2e/android/e2e-results.xml`, `artifacts/e2e/android/e2e-debug/`, `artifacts/e2e/backend/staging-critical-e2e.json`.
- PASS: İki workflow job'u başarılı; JUnit failure/error 0; backend JSON'daki her adım `passed`; offline mesaj sunucuda tam bir kez.
- FAIL: Job skip/failure, boş artifact, herhangi bir assertion hatası, test hesabı cleanup hatası veya duplicate replay.

## 4. 25 → 250 → 10K staging load

- Prerequisite: `staging-load-test` environment secret'ları, staging'e özel JWT havuzu ve test ID'leri; production endpoint kullanılmamalıdır.
- Command:

  ```powershell
  gh workflow run staging-load-test.yml --ref <protected-tag-at-commit-sha> `
    -f target_sha=<full-commit-sha> -f confirmation=staging-10k -f target_vus=10000
  gh run watch --exit-status
  gh run download <run-id> -n staging-mixed-load-evidence-10000vu `
    -D artifacts/load/10000vu
  ```

- Expected result: Workflow sırasıyla 25 VU/3 dk, 250 VU/5 dk ve 10K VU/15 dk kapılarını geçer; k6 threshold'ları fail-closed'dur.
- Artifact: `artifacts/load/10000vu/load-low-25vu.json`, `load-medium-250vu.json`, `load-target-10000vu.json`.
- PASS: Üç koşu da exit 0 ve JSON threshold sonuçları başarılı; veri bütünlüğü/idempotency kontrolü temiz.
- FAIL: Daha düşük kapı atlanır, threshold ihlali, production hedefi, eksik artifact veya veri tutarsızlığı.

## 5. Fiziksel cihaz, erişilebilirlik ve gerçek push

- Prerequisite: En az küçük/büyük iPhone ile 360/411/480dp Android telefon; production-benzeri staging build; APNs/FCM/Expo credentials; iki test hesabı. Matris [device-matrix.md](device-matrix.md) ile aynıdır.
- Command/checklist:

  ```powershell
  adb devices -l
  adb install -r <staging-apk>
  adb shell settings put system font_scale 2.0
  adb shell am force-stop com.etkinlink.app
  adb shell monkey -p com.etkinlink.app 1
  adb logcat -c
  # Test bitince:
  adb bugreport artifacts/device-matrix/android-<device>-bugreport.zip
  adb shell settings put system font_scale 1.0
  ```

  iOS'ta aynı akışlar Xcode Devices and Simulators ile fiziksel cihazda; Dynamic Type %200 ve VoiceOver açıkken kaydedilir. Android'de TalkBack ile tekrar edilir. Push; foreground, background, terminated, token rotation ve uninstall/reinstall durumlarında iki platformda denenir.

- Expected result: Auth, klavye, modal, etkinlik, matching, oda/DM ve offline reconnect kesilmeden kullanılır; odak sırası/label/role/disabled durumları doğru; bildirim deep-link'i yalnızca oturum ve yetkili kaynak varsa hedefe gider.
- Artifact: `artifacts/device-matrix/<utc-date>/<platform-device>/` altında video, ekran görüntüsü, OS/build bilgisi, bugreport/sysdiagnose ve doldurulmuş checklist; push için notification event/delivery/receipt ID'leri.
- PASS: Matrisin her zorunlu satırı ve beş push durumu iki platformda tarihli kanıtlı; crash/ANR, kesilen içerik, odak tuzağı veya yetkisiz deep-link yok.
- FAIL: Emulator tek başına kullanılır, satır atlanır, push yalnızca foreground'da çalışır, TalkBack/VoiceOver yapılmaz veya artifact build SHA ile eşleşmez.

## 6. Signed Android AAB ve iOS IPA

- Prerequisite: Önceki commit-SHA CI, son 7 gün E2E ve son 30 gün 10K artifact'ları; `production` environment signing/EAS/Sentry/Supabase secret'ları; onaylı release commit'i; onaylı public identity var'ları olarak 64 büyük-hex `ANDROID_SIGNING_CERT_SHA256` ve 10 büyük-alfasayısal `IOS_SIGNING_TEAM_ID`.
- Command:

  ```powershell
  gh workflow run mobile-release.yml --ref <protected-tag-at-commit-sha> -f target_sha=<full-commit-sha>
  gh run watch --exit-status
  gh run download <run-id> -n release-prerequisite-evidence -D artifacts/release/prerequisites
  gh run download <run-id> -n etkinlink-production-aab -D artifacts/release/android
  gh run download <run-id> -n etkinlink-production-ipa-evidence -D artifacts/release/ios
  Get-FileHash artifacts/release/android/app-release.aab -Algorithm SHA256
  Get-FileHash artifacts/release/ios/EtkinLink.ipa -Algorithm SHA256
  ```

- Expected result: Release-evidence commit zinciri geçer; AAB strict `jarsigner`, R8 mapping ve release guard'ları geçer; artifact signer certificate fingerprint onaylı Android değeriyle tam eşleşir. IPA codesign geçer; codesign ve entitlement Team ID değerleri onaylı Apple Team ID ile, application identifier da Team ID + bundle ID ile eşleşir; `aps-environment=production`, privacy manifest mevcut; iki platform source map'leri Sentry'de bulunur.
- Artifact: `release-prerequisite-evidence.json`, `app-release.aab`, `mapping.txt`, `android-signer-identity.json`, `EtkinLink.ipa`, `ios-entitlements.plist`, `ios-signer-identity.json`, `PrivacyInfo.xcprivacy`, `eas-ios-build.json` ve kaydedilmiş SHA-256 dosyası.
- PASS: İki release job'u başarılı, imza kimliği/entitlement/source-map kontrolleri temiz, identity JSON'ları hedef SHA'yı içeriyor ve hash'ler mağazaya yüklenen binary ile aynı.
- FAIL: Debug/ad-hoc imza, eksik mapping/privacy/source map, SHA uyuşmazlığı veya yalnızca tek platform artifact'ı.

## 7. Sentry production evidence

- Prerequisite: `production-monitoring` environment Sentry API/alert secret'ları; production release health verisi; yalnızca sentetik test hesabıyla PII canary.
- Command:

  ```powershell
  gh workflow run configure-monitoring.yml --ref <protected-tag-at-commit-sha>
  gh run watch --exit-status
  ```

- Expected result: Altı detector idempotent oluşur; son 24 saat crash-free sessions varsayılan en az `%99,5`; release/source map doğrulaması geçer; canary event'inde e-posta, username, mesaj, access/refresh token ve authorization alanları yoktur veya `[Filtrelendi]`dir.
- Artifact: GitHub Actions run log URL'si, detector ID/export listesi, Sentry release/source-map API özeti, secretsiz canary ekran görüntüsü ve crash-free JSON'u `artifacts/monitoring/<release>/` altında.
- PASS: Detector'ler aktif, health verisi mevcut ve eşik üstünde, PII sızıntısı yok.
- FAIL: Health verisi yok, threshold altı, source map eksik, detector eksik/kapalı veya canary'de ham PII/token görünür.

## 8. Store console ve gizlilik eşleşmesi

- Prerequisite: Onaylı [privacy-data-inventory.md](privacy-data-inventory.md), [google-play-data-safety.md](google-play-data-safety.md), iOS privacy manifest ve signed artifact hash'leri; yetkili App Store Connect/Play Console hesabı.
- Command: App Store Connect privacy nutrition labels ve Google Play Data Safety formunu envanterle alan-alan karşılaştır; signed artifact'ları internal track/TestFlight'a yükle; pre-launch raporlarını indir.
- Expected result: Toplanan/paylaşılan veri, retention, account deletion, tracking ve izin beyanları repo envanteriyle birebir; yüklenen binary hash'i release artifact hash'iyle aynı.
- Artifact: `artifacts/store/<release>/app-store-privacy.pdf`, `play-data-safety.pdf`, upload/build ekranı, pre-launch raporları ve `artifact-hashes.txt`.
- PASS: İki konsol beyanı onaylı ve envanterle fark yok; pre-launch blocker yok; hash eşleşiyor.
- FAIL: Form eksik/draft, veri kategorisi farkı, account deletion yolu eksik, blocker raporu veya hash farkı.

## 9. İncelenmiş manuel kanıt paketi

- Prerequisite: Hedef commit'e doğrudan çözümlenen korumalı bir tag ve o tag için yayımlanmış, prerelease olmayan aynı-repo GitHub Release kaydı. Release onayı kanıtların kendisini incelemiş olmalıdır.
- Bundle: Release'e `manual-release-evidence.zip` ekleyin. Tamamlanan her manuel kapı için kökte kapı ID'siyle aynı adlı dizin kullanın: `real_devices_and_push`, `ota_preview_rollback`, `cloudflare_preview_rollback`, `backup_restore`, `monitoring_slo`, `store_console`.
- Attestation: Her kapı dizinindeki `attestation.json`; `schemaVersion: 1`, doğru `gateId`, tam küçük-harf hedef `targetSha`, `decision: "approved"`, boş olmayan `reviewer`, ISO-8601 `reviewedAt` ve boş olmayan göreli `evidenceFiles` dizisini içermelidir. Listedeki her dosya aynı kapı dizininde normal dosya olmalıdır; `..`, mutlak yol ve symlink kabul edilmez.
- Command: `release-evidence.yml` workflow'unu aynı-SHA otomatik run ID'leri, `manual_evidence_release_tag` ve tam asset adıyla `main` ref'inden dispatch edin.
- PASS: Workflow Release/tag/SHA bağını, her attestation'ı ve her listelenen dosyayı doğrular; manifest bütün dosyaları SHA-256 ile kaydeder ve tüm zorunlu kapılar `verified` ise `GO` üretir.
- FAIL: Yanlış tag/SHA, draft/prerelease, eksik/boş ZIP, bozuk attestation, onay dışı karar, eksik dosya veya güvenli olmayan yol workflow'u durdurur. Eksik kapı sessizce PASS olmaz; `missing` kalır ve karar `NO-GO` olur.

## Nihai karar

Yukarıdaki sekiz runtime kapısının her biri aynı release commit'iyle PASS olmadan karar **NO-GO**'dur. `mobile-release.yml` içindeki prerequisite kontrolü yalnızca CI/E2E/load kanıt zincirini otomatik doğrular; fiziksel cihaz, gerçek push, Sentry canary ve store-console kanıtları ayrı release onayında incelenip dokuzuncu bölümdeki değişmez pakete bağlanmalıdır.

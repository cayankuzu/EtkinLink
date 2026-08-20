# Release evidence runbook

Bu belge yalnızca repo dışı ortam/kimlik bilgisi gerektiren kapıları tanımlar. Mock, yerel statik kontrol, eski ekran görüntüsü veya debug imzası bu kanıtların yerine geçmez. Komutlarda secret değerlerini argüman olarak veya artifact içine yazmayın.

Her koşu için commit SHA, UTC zamanı, ortam adı, workflow run URL'si ve artifact SHA-256 değeri kanıt kaydına eklenmelidir.

## 1. Staging migration, lint ve pgTAP

- Prerequisite: Production'dan ayrı Supabase staging projesi; Supabase CLI oturumu; `staging-security` GitHub environment'inda `STAGING_DATABASE_URL` ve `STAGING_PROJECT_REF`. Ref production ref'i olmamalıdır.
- Command:

  ```powershell
  npx supabase login
  npx supabase link --project-ref <staging-project-ref>
  npx supabase migration list --linked
  npx supabase db push --linked
  gh workflow run mobile-ci.yml --ref <commit-sha>
  gh run watch --exit-status
  ```

- Expected result: Migration history eşitlenir; `db lint --fail-on warning` temizdir; pgTAP `1..34` ve 34 adet `ok` üretir.
- Artifact: GitHub Actions `staging-database-security-evidence/db-lint.txt` ve `staging-database-security-evidence/pgtap.txt`.
- PASS: Workflow `database-security` başarılı, lint warning/error yok, pgTAP'te `not ok` yok ve plan 34.
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
  curl.exe -sS -o artifacts/staging-push-drain.json -w "%{http_code}" `
    -X POST "$workerUrl/push-dispatch" -H "content-type: application/json" `
    -H "x-push-worker-secret: $env:PUSH_WORKER_SECRET" `
    --data '{"drain":true,"batchSize":1}'
  ```

- Expected result: Eksik ve eski/revoke edilmiş secret `401`; aktif secret ile boş drain `200`; duplicate event claim `202/skipped`; gerçek olayda enqueue → claim → delivery → receipt durumları ilerler. Partial failure başarılı tokenı kaybetmez; `DeviceNotRegistered` tokenı `disabled_at` ile kapatır; geçici receipt en çok beş denemeden sonra final olur.
- Artifact: `artifacts/staging-push-unauthorized.json`, `artifacts/staging-push-drain.json`, zaman damgalı ve test ID'sine filtrelenmiş `notification_events`/`notification_deliveries`/`push_tokens` CSV'leri, Expo receipt cevabının secretsiz özeti.
- PASS: Yetki sınırı ve tüm durum geçişleri beklenen değerlerde; aynı dedupe key için tek event/delivery; invalid token kapalı.
- FAIL: Worker anonim erişilebilir, event çift dispatch olur, pending lease takılı kalır, retry sınırsızdır veya invalid token aktif kalır.

## 3. Staging backend ve Android Maestro E2E

- Prerequisite: `staging-e2e` environment secret/variable'ları; API 34 x86_64 runner; staging seed event/room/match verileri.
- Command:

  ```powershell
  gh workflow run mobile-e2e.yml --ref <commit-sha>
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
  gh workflow run staging-load-test.yml --ref <commit-sha> `
    -f confirmation=staging-10k -f target_vus=10000
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

- Prerequisite: Önceki commit-SHA CI, son 7 gün E2E ve son 30 gün 10K artifact'ları; `production` environment signing/EAS/Sentry/Supabase secret'ları; onaylı release commit'i.
- Command:

  ```powershell
  gh workflow run mobile-release.yml --ref <commit-sha>
  gh run watch --exit-status
  gh run download <run-id> -n release-prerequisite-evidence -D artifacts/release/prerequisites
  gh run download <run-id> -n etkinlink-production-aab -D artifacts/release/android
  gh run download <run-id> -n etkinlink-production-ipa-evidence -D artifacts/release/ios
  Get-FileHash artifacts/release/android/app-release.aab -Algorithm SHA256
  Get-FileHash artifacts/release/ios/EtkinLink.ipa -Algorithm SHA256
  ```

- Expected result: Release-evidence commit zinciri geçer; AAB strict `jarsigner`, R8 mapping ve release guard'ları geçer; IPA codesign geçer, `aps-environment=production`, privacy manifest mevcut; iki platform source map'leri Sentry'de bulunur.
- Artifact: `release-prerequisite-evidence.json`, `app-release.aab`, `mapping.txt`, `EtkinLink.ipa`, `ios-entitlements.plist`, `PrivacyInfo.xcprivacy`, `eas-ios-build.json` ve kaydedilmiş SHA-256 dosyası.
- PASS: İki release job'u başarılı, imza/entitlement/source-map kontrolleri temiz ve hash'ler mağazaya yüklenen binary ile aynı.
- FAIL: Debug/ad-hoc imza, eksik mapping/privacy/source map, SHA uyuşmazlığı veya yalnızca tek platform artifact'ı.

## 7. Sentry production evidence

- Prerequisite: `production-monitoring` environment Sentry API/alert secret'ları; production release health verisi; yalnızca sentetik test hesabıyla PII canary.
- Command:

  ```powershell
  gh workflow run configure-monitoring.yml --ref <commit-sha>
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

## Nihai karar

Yukarıdaki sekiz kapının her biri aynı release commit'iyle PASS olmadan karar **NO-GO**'dur. `mobile-release.yml` içindeki prerequisite kontrolü yalnızca CI/E2E/load kanıt zincirini otomatik doğrular; fiziksel cihaz, gerçek push, Sentry canary ve store-console kanıtları ayrı release onayında incelenmelidir.

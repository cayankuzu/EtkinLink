# Güncel boşluk matrisi

Bu belge, dış denetim bulgularının bu çalışma ağacındaki **doğrulanmış** durumunu kaydeder. Her satır repository gerçeğine karşı yeniden üretilmiştir; hiçbir durum varsayımla işaretlenmemiştir.

Durum etiketleri: `CONFIRMED`, `FIXED SINCE AUDIT`, `REGRESSED`, `NOT REPRODUCIBLE`, `RUNTIME/PROVIDER EVIDENCE REQUIRED`.

Doğrulama commit'i: `git rev-parse HEAD` — komut çıktıları [quality-gates.md](../quality-gates.md) içindeki `2026-09-03 güncel yerel sonuç` tablosundadır.

## Denetim bulguları

| # | Bulgu | Durum | Doğrulama |
| - | ----- | ----- | --------- |
| 1 | Ürün yüzeyi 5 tab, 43 stack route, 39 screen entrypoint, 15 modal, 9 notification type, 26 public table olarak dondurulmuştur | `CONFIRMED` | `npm run feature-freeze` → 5 tab / 43 route / 39 ekran / 26 tablo; `quality/feature-surface.snapshot.json` → 9 notification type, 12 dosyada toplam 15 modal örneği |
| 2 | Kullanıcı işleri auth/onboarding, event discovery/detail/saved, rooms, matching, direct messages, profile/settings/block/legal akışlarıdır | `CONFIRMED` | `docs/existing-feature-contract.md` ve 40 `*Screen.tsx` dosyasının denetimi |
| 3 | Son mobil kalite GitHub Actions koşusu güncel SHA için başarılıdır | `RUNTIME/PROVIDER EVIDENCE REQUIRED` | Bu ağaçta yeni commit'ler vardır; aynı-SHA CI sonucu henüz üretilmemiştir. Yerel eşdeğeri (`npm --prefix mobile run verify`) geçer |
| 4 | App/runtime 1.0.9; iOS `Expo.plist` OTA etkin | `CONFIRMED` | `mobile/app.json` → version `1.0.9`, runtimeVersion `1.0.9`, versionCode `10`, buildNumber `10`; `Expo.plist` → `EXUpdatesEnabled=true`, runtime `1.0.9` |
| 5 | Android source'ta update URL/runtime metadata var; effective enabled/channel signed artifact'tan doğrulanmalı | `CONFIRMED` | `AndroidManifest.xml` `EXPO_UPDATE_URL`, `EXPO_RUNTIME_VERSION`, `EXPO_UPDATES_CHECK_ON_LAUNCH`, `EXPO_UPDATES_LAUNCH_WAIT_MS` içerir; **açık `ENABLED` anahtarı ve channel metadata'sı yoktur** — etkin durum yalnız imzalı AAB incelemesiyle bilinir |
| 6 | `infra/cloudflare/etkinlink-edge` Worker, testler ve wrangler config içerir | `CONFIRMED` | 5 kaynak dosyası, 4 test dosyası, `wrangler.jsonc`; `npm run check` → typecheck/lint/format temiz, vitest 32/32; `npm run dry-run` → development/preview/production üçü de derlenir |
| 7 | Cloudflare production workflow'u kasıtlı `exit 1` ile deployment'ı bloke eder | `CONFIRMED` | `.github/workflows/cloudflare-production.yml:128` — "Block unsafe production version mutation" adımı; workflow'da hiçbir upload/deploy komutu yoktur |
| 8 | EAS preview workflow'u publication'ı bloke eder | `CONFIRMED` | `.github/workflows/eas-update-preview.yml:113` — trust tasarımı tamamlanana kadar fail-closed |
| 9 | EAS production workflow'u publication'ı bloke eder | `CONFIRMED` | `.github/workflows/eas-update-production.yml:196` |
| 10 | Release-readiness aynı-SHA signed artifact, staging E2E/load, fiziksel cihaz push/accessibility, OTA/Worker rollback, restore, monitoring alarm ve store form eksikleri nedeniyle `NO-GO` | `CONFIRMED` | `docs/release-readiness.md`; dış kanıt kapıları açık |
| 11 | Production readiness belgesi local/staging DB testlerinde Docker kullanılmadığını belirtiyordu | `FIXED SINCE AUDIT` | `infra/docker/` canonical Supabase CLI profili eklendi; `npm run docker:test` → 57 migration replay, `public` lint 0 bulgu, 7 dosya / 283 pgTAP, dump/restore, Edge/Worker/upstream contract. `docker-validation.yml` fail-closed iş olarak eklendi |
| 12 | Event ingestion, push-dispatch/push-receipts ve sync-event mevcut background işleridir; çift scheduler veya iki source of truth kurulmamalıdır | `CONFIRMED` | 6 Edge Function; Cloudflare Queue/D1/KV eklenmedi, Supabase outbox tek teslim yolu olarak korundu (bkz. [architecture-and-kiss-report.md](../architecture-and-kiss-report.md)) |
| 13 | Ürün sözleşmesi portrait phone uygulamasıdır; tablet/landscape kapsam dışıdır | `CONFIRMED` | `npm --prefix mobile run compatibility:guards` → 4 ABI, 360/411/480dp sınıfı, portrait yönü ve tablet dışlama kararı doğrulandı |
| 14 | Bu fail-closed davranış güvenli başlangıçtır fakat "Cloudflare/OTA kuruldu" anlamına gelmez | `CONFIRMED` | 7–9 numaralı satırlar; sağlayıcı erişimi olmadan gerçek rollout/rollback kanıtı üretilemez |

## Bu turda kapatılan ek boşluklar

Aşağıdakiler denetim listesinde yoktu; bu turda repository denetimiyle bulundu ve kapatıldı.

| Boşluk | Şiddet | Nasıl bulundu | Durum |
| ------ | ------ | ------------- | ----- |
| Supabase varsayılan ayrıcalıkları, `auth.uid()` okuyan 43 owner-scoped RPC'nin tamamını `service_role`'a, 38'ini `anon`'a açık bırakmıştı | P1 — yetki sınırı | `npm run docker:test` içindeki pgTAP testi 9 gerçekten başarısız oldu; izole yerel DB'de ACL'ler sorgulanarak kök neden doğrulandı | `FIXED` — forward-only ACL migration + `rpc_role_acl_contract.sql` (6 değişmez) |
| Altı çağrı yeri ham sağlayıcı hatasını konsola yazıyordu; release derlemesinde bu logcat/os_log'a gider ve Expo push tokenı / imzalı Storage URL'si sızabilir | P1 — gizlilik | Kaynak taraması; aynı dosya ailesinde iki farklı örüntü | `FIXED` — `telemetry.warnRedacted`, ESLint `no-console`, guard |
| iOS'ta `Pressable` varsayılan gruplaması dört yüzeyde kontrolleri VoiceOver'dan gizliyordu | P1 — erişilebilirlik | Dokunma hedefi taraması | `FIXED` — 8 nitelik düzeltmesi + `check-accessibility-guards.mjs` |
| Tema dışında 18 ham renk; aynı görsel rol için iki siyah zemin, dört beyaz alfa, `overlay` tokenının iki kopyası | P2 — tutarlılık | Kaynak taraması | `FIXED` — tokenlar + `check-hardcoded-values.mjs` |
| Thread sayfa boyutu aynı anda üç yerde tanımlıydı; roster sınırı adsızdı | P2 — DRY | Kaynak taraması | `FIXED` — `paginationLimits` + guard kuralı |
| `mobile-ci.yml` Supabase CLI 2.115.0, Docker profili 2.116.0 pinliyordu | P2 — tekrar üretilebilirlik | Toolchain karşılaştırması | `FIXED` — hizalandı + eşleşme guard'ı |
| `docs/quality-gates.md` ve `docs/production-readiness.md` 55 migration / 5 pgTAP / 251 plan sayılarını taşıyordu | P3 — belge doğruluğu | Sayım | `FIXED` — 57 / 7 / 283 |

## Açık kalan kapılar

Aşağıdakiler yalnız sağlayıcı erişimi, imzalı artifact veya fiziksel cihazla kapatılabilir; hiçbiri bu ağaçta PASS sayılmaz:

- aynı-SHA `mobile-ci.yml` ve `docker-validation.yml` artifact'ları (yerel ağaç `gitTreeClean=false` iken üretilen kanıt aynı-SHA sayılmaz);
- gerçek Cloudflare hesabı/zone, preview Worker, %5→%25→%50→%100 rollout ve rollback;
- gerçek EAS preview/production OTA yayını, runtime eşleşme/uyuşmazlık ve rollback provası;
- imzalı AAB/IPA üzerinden effective OTA `enabled`/channel doğrulaması;
- fiziksel iOS/Android cihazda push teslim/tap matrisi ve VoiceOver/TalkBack gezinmesi;
- izole staging'de 25→250→1.000→10.000 VU yük profili;
- PITR/backup panel kanıtı ve ayrı ortama restore tatbikatı;
- Sentry alarm fire/recover kanıtı;
- store privacy/data-safety formları ve TestFlight/Internal Track smoke.

Bu kapılar kapanana kadar release kararı `NO-GO` kalır ([release-readiness.md](../release-readiness.md)).

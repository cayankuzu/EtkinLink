# AAA-MVP başlangıç durumu

Tarihsel feature-freeze baseline commit'i: `f8a1e48de47d49021ea092c609440240fd13e23d`
Bu hardening görevinin `origin/main` başlangıç commit'i: `20dc22c76174ab7a9c1a2fae79ed89e45597b57e`
Tarihsel yerel inceleme tarihi: 2026-08-30; güncel görev yeniden doğrulaması: 2026-08-31
Başlangıç release kararı: **NO-GO**

Bu belgedeki sayısal puan tablosu 2026-08-30 tarihsel ölçümünü korur; güncel final skor veya release kanıtı değildir. `20dc22c...` başlangıcında OTA kaynak yapılandırması Android ve iOS'ta açıktır, Android metadata'sı ve EAS kanalları vardır; ancak imzalı artifact/runtime parity kanıtı yoktur. Signed artifact, staging, fiziksel cihaz, restore ve provider dashboard kanıtı olmadığı için hiçbir güncel alan 9.80 olarak işaretlenmez. Canonical güncel karar `release-readiness.md` içindedir.

## Özellik dondurma kanıtı

- Başlangıç: 5 tab, 43 stack route, 39 ekran entrypoint'i, 15 mevcut modal, 26 public tablo.
- `node scripts/guards/check-no-new-product-surface.mjs`: geçti.
- Guard self-test'i yeni route, Android izni, Settings CTA'sı ve ürün tablosunu fail-closed yakaladı.
- Kullanıcı kapsamı `docs/existing-feature-contract.md`, makine sözleşmesi `quality/feature-surface.snapshot.json` içindedir.

## Yerel otomatik baseline

| Kapı             | Gerçek sonuç                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| TypeScript       | `tsc --noEmit` exit 0                                                                            |
| Lint/format      | ESLint exit 0; Prettier tüm eşleşen dosyalar temiz                                               |
| Mimari/dead code | 232 modül/946 dependency, ihlal yok; Knip exit 0                                                 |
| Jest             | 42/42 suite, 231/231 test, snapshot 0                                                            |
| Secret scan      | Gitleaks 10 commit/2.37 MB, leak yok                                                             |
| Expo Doctor      | 19/20; 12 Expo/RN patch sürümü uyumsuz                                                           |
| Production audit | `image-size`/Metro zincirinde 5 high; audit exit 1                                               |
| Semgrep          | Binary dosya ACL hatası nedeniyle baseline koşusu tamamlanmadı; PASS değildir                    |
| DB               | Docker daemon kapalı; migration replay/db lint/pgTAP/restore yerelde çalışmadı                   |
| Eski AAB         | 2026-08-19 tarihli, current SHA'ya bağlı değil; strict jarsigner exit 4. Release kanıtı değildir |

## 35 alan başlangıç puanı

|   # | Alan                | Başlangıç | Ölçülebilir başlangıç problemi                                                      | Kullanıcı etkisi / blast radius |
| --: | ------------------- | --------: | ----------------------------------------------------------------------------------- | ------------------------------- |
|   1 | UI/UX               |      8.40 | Tasarım sistemi mevcut; screen-level ve görsel regresyon kanıtı yok                 | Tüm mevcut ekran durumları      |
|   2 | Çoklu cihaz         |      7.20 | Matris/runbook var; güncel fiziksel iOS/Android kanıtı yok                          | Tüm mobil yüzey                 |
|   3 | Performans          |      7.40 | Statik bütçe var; cold/warm, FPS, memory p95 ölçümü yok                             | Başlangıç ve ana listeler       |
|   4 | Güvenlik/gizlilik   |      7.40 | Ayrılan oda üyesi RLS okuması ve signed-photo disk cache riski                      | Mesajlar ve private medya, P0   |
|   5 | Mimari              |      8.70 | Feature-first sınırları var; UI/application/data/platform guard'ı dar               | Bakım ve değişiklik riski       |
|   6 | DRY                 |      8.80 | Ortak bileşen/servis kullanımı iyi; ölçülü tekrar analizi manuel                    | Kod tabanı                      |
|   7 | Hardcode/config     |      8.00 | Supabase schema doğrulamalı; ayrı edge URL/environment sözleşmesi yok               | Event HTTP cutover              |
|   8 | State               |      7.70 | Owner cache var; Discover optimistic rollback ve outbox dead-letter eksik           | Save ve mesaj gönderme          |
|   9 | Network/API         |      7.40 | Ortak timeout var; event signal/fallback/retry-after/error contract eksik           | Event feed ve hata toparlama    |
|  10 | Accessibility       |      8.20 | 44/48dp, label, safe-area temeli var; VoiceOver/TalkBack kanıtı yok                 | Tüm ekranlar                    |
|  11 | Ölçek               |      6.50 | k6 senaryosu var; staging 25→250→10K ve DB plan kanıtı yok                          | Backend kapasitesi              |
|  12 | Dayanıklılık        |      7.30 | Offline outbox var; provider outage, DLQ, restore/rollback tatbikatı yok            | Mesaj, event ve release         |
|  13 | Testler             |      8.50 | 231 unit/integration test; DB/Worker/OTA/gerçek E2E kanıtı eksik                    | Tüm P0 akışlar                  |
|  14 | Yerelleştirme       |      8.80 | Türkçe/UTF-8 tutarlı; otomatik copy/locale guard sınırlı                            | Görünür metinler                |
|  15 | Offline             |      7.50 | Snapshot/outbox var; privacy purge, dead-letter ve 24 saat replay eksik             | Event feed ve mesaj             |
|  16 | Push/deep link      |      7.60 | Dedupe/token lifecycle kodu var; fiziksel delivery/tap yok                          | Bildirim akışları               |
|  17 | Gözlemlenebilirlik  |      8.00 | Sentry redaction ve runbook var; Worker/DB korelasyon/alarm kanıtı yok              | Operasyon                       |
|  18 | CI/CD               |      8.40 | Pinli mobil/DB/release jobs var; freeze/Cloudflare/OTA/evidence workflow'ları yok   | Deploy güvenliği                |
|  19 | Dokümantasyon       |      8.30 | Güçlü mevcut runbook'lar; master teslimat seti ve güncel sonuçlar eksik             | Operasyon/release               |
|  20 | Domain mantığı      |      8.60 | Atomik RPC/unique/idempotency yaygın; bazı concurrency/RLS adversarial açıkları var | Oda/match/message               |
|  21 | Bağımlılıklar       |      7.40 | Lockfile var; 12 patch mismatch ve 5 high advisory                                  | Build/supply chain              |
|  22 | Batarya/kaynak      |      7.20 | Lifecycle yönetimi var; cihaz battery/thermal ölçümü yok                            | Uzun oturumlar                  |
|  23 | Platform uyumu      |      6.90 | 2026-08-30 tarihsel ölçümde OTA/native parity ve Doctor açığı raporlandı; güncel kaynakta OTA açıktır, signed artifact kanıtı hâlâ yoktur | İki platform release, P0 |
|  24 | Store readiness     |      7.00 | Checklist/privacy belgeleri var; signed store artifact/console kanıtı yok           | Yayın                           |
|  25 | Operasyon olgunluğu |      7.50 | Runbook/SLO taslağı var; restore/canary/incident tatbikatı yok                      | Production                      |
|  26 | Okunabilirlik       |      8.70 | Strict TS ve feature modülleri iyi; karmaşıklık bütçesi sınırlı                     | Geliştirme                      |
|  27 | Genel olgunluk      |      7.40 | Repo otomasyonu güçlü; P0 RLS/privacy ve dış kanıtlar açık                          | Release bütünü                  |
|  28 | Kod mimarisi        |      8.30 | Bağımlılık yönü guard'lı; ekranlardan doğrudan data erişimi hâlâ var                | Test edilebilirlik              |
|  29 | Kod kalitesi        |      8.70 | Typecheck/lint/format temiz; bazı broad/silent catch ve güvenli error mapping açığı | Hata davranışı                  |
|  30 | KISS                |      9.00 | Supabase tek source of truth; gereksiz edge/storage ürünü yok                       | Sistem bütünü                   |
|  31 | Kod hardcode        |      8.00 | Ortak limit/tokenlar var; timeout/OTA/edge/release değerleri dağınık                | Network/release                 |
|  32 | Yeniden kullanım    |      8.60 | Ortak UI/query/network servisleri yaygın                                            | Mobil kod                       |
|  33 | Kod performansı     |      8.10 | FlashList/cache/dedupe var; profiling ve gerçek regresyon bütçesi yok               | Feed/chat hot path              |
|  34 | Test edilebilirlik  |      8.10 | Supabase mock/fake timers mevcut; provider/clock/fault injection eksik              | Network/ingest/OTA              |
|  35 | Genişletilebilirlik |      8.30 | Tipli contract/RPC yapısı var; stable edge hostname/runtime classifier yok          | Geriye uyumlu dağıtım           |

## Başlangıç risk kaydı

| Öncelik | Risk                                                                              | Etkilenen mevcut akış | Blast radius                | Başlangıç azaltma/rollback                                                                   |
| ------- | --------------------------------------------------------------------------------- | --------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| P0      | `room_messages` SELECT/Realtimes policy ayrılmış üyede `status='joined'` aramıyor | Odalar                | Private mesaj geçmişi       | Forward-only policy migration; migration rollback yalnız eski policy'yi kontrollü geri kurar |
| P0      | Signed profile URL'leri disk cache ve feed snapshot'a girebiliyor                 | Profil/event cards    | Cross-session private medya | Memory-only/no-store ve logout purge                                                         |
| P0      | Tarihsel OTA wiring/parity açığı; güncel durumda signed binary ve rollback kanıtı yok | Startup/release    | İki platform                | Production update yayımlamadan önce same-SHA signed binary, signature ve rollback kanıtı     |
| P1      | Event ingest chunk'ları kısmi görünür, upstream response/retry sınırı zayıf       | Event catalog         | Katalog doğruluğu           | Transaction RPC; eski Function sürümüne rollback                                             |
| P1      | Event fallback abort/auth hatalarını RSS fan-out'a çevirebilir                    | Keşfet                | Ağ/batarya/provider         | Error classification, signal ve bounded fallback                                             |
| P1      | Optimistic save rollback/outbox dead-letter eksik                                 | Saved events/messages | Veri/UI tutarlılığı         | Snapshot rollback ve bounded outbox                                                          |
| P1      | Cloudflare stable gateway/WAF/cache katmanı yok                                   | Public event API      | Abuse/hostname cutover      | Optional edge config; direct Supabase compatibility                                          |
| P1      | Expo patch mismatch ve high transitif advisory                                    | Build/supply chain    | Build araç zinciri          | Expo-compatible patch upgrade; lockfile rollback                                             |

## Release ve rollback başlangıç planı

1. Feature-freeze guard her değişiklikte çalışır.
2. Migration'lar yalnız forward-only ek dosyadır; production history yeniden yazılmaz.
3. Mobil edge transport `EDGE_API_BASE_URL` yoksa mevcut direct Supabase contract'ına döner.
4. Worker preview ayrı deploy edilir; production origin kapatılmaz ve Worker bağımsız rollback edilir.
5. Native/OTA değişikliği ilk yeni AAB+iOS binary olmadan production update olarak yayımlanmaz.
6. Signed artifacts, staging DB/E2E, fiziksel cihaz, push, load, restore ve dashboard evidence aynı final commit SHA'ya eklenene kadar karar **NO-GO** kalır.

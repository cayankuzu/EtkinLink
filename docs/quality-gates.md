# Kalite kapıları ve dürüst kapsam

## Otomatik kapılar

- `npm run verify`: TypeScript strict, ESLint, Prettier, Dependency Cruiser, Knip, güvenlik/uyumluluk/performans/erişilebilirlik/tasarım-tokenı guard'ları ve bunların self-test'leri, kritik akış referansları, OTA classifier, release signer testleri ve Jest.
- Jest tüm `src` dosyalarını coverage kapsamında tutar. Kapsam listesi daraltılmaz.
- Jest global eşik havuzu statement `%36`, branch `%27`, function `%26`, line `%37` altında fail olur. Dosya-bazlı eşikler nedeniyle bu havuzun güncel sonucu sırasıyla `%37,02 / %27,71 / %26,90 / %38,39`dur.
- Ayrı ratchet tüm-dosya kapsamını `%38 / %28 / %28 / %39` altına düşürmez; 17 değişen kritik uygulama/güvenlik modülünü ayrı sabit tabanlarla denetler.
- `chatOutbox`, `compatibility` ve `roomRules` için Jest dosya eşikleri; daha geniş kritik modül listesi için `coverage:ratchet` fail-closed'dur.
- Yedi pgTAP dosyasındaki `36 + 54 + 61 + 50 + 26 + 50 + 6 = 283` planlı kontrol anon/auth/service rol ayrımını, RLS/IDOR'u, moderasyon, recursive account deletion/Storage, push delivery/replay, push installation lifecycle, owner-scoped RPC rol ACL sözleşmesi ve ingestion idempotency sınırlarını doğrular.
- Deno kapısı production Function kaynaklarını lint eder, tüm Edge Function girişlerini format/type-check eder ve bounded HTTP, HMAC, push, ingestion ve account deletion için 68 testi çalıştırır.
- `docker-validation.yml`; canonical Supabase CLI test profili, Compose sözleşmesi, migration/lint/pgTAP, dump/restore, Edge/Worker contract, Toxiproxy fault injection, bounded sentetik k6 yükü, tekrar üretilebilir build, Hadolint, HIGH/CRITICAL vulnerability kapısı, CycloneDX SBOM, provenance ve project-scoped cleanup kanıtlarını ayrı fail-closed işler olarak üretir.
- Production dependency audit istisnasız biçimde herhangi bir high/critical bulguda durur; Metro `0.84.5` hizalamasıyla eski `image-size` allowlist'i kaldırılmıştır.
- Release evidence kapısı aynı commit mobil CI artifact'ı, son 7 gün staging E2E artifact'ı ve son 30 gün 10K staging load artifact'ı arar.

## 2026-08-19 tarihsel yerel sonuç

> Bu bölüm yalnız tarihsel baseline'dır. Mevcut hardening commit'inin final test çıktısı değildir; test sayıları ve Doctor/audit sonucu değişmiş olabilir. Release kararı yalnız aynı SHA `mobile-ci.yml` ve [release-readiness.md](release-readiness.md) kanıtıyla verilir.

- Jest: **42/42 suite, 229/229 test** geçti.
- Gerçek tüm-dosya coverage: statement `%38,93`, branch `%29,52`, function `%28,78`, line `%40,25`.
- Başlangıç tüm-dosya tabanı `%21,12 / %15,78 / %15,73 / %22,10` idi. Artış sırasıyla `+17,81 / +13,74 / +13,05 / +18,15` puandır.
- Başlangıç Jest global-havuz tabanı `%18,66 / %13,64 / %13,48 / %19,67`; sonuç `%37,02 / %27,71 / %26,90 / %38,39`dur.
- Changed-critical aggregate: statement `%90,98`, branch `%79,03`, function `%94,96`, line `%95,93`.
- Kritik örnekler: registration `%96,29`, event controller `%92,85`, room realtime `%94,36`, message service `%89,83`, profile `%90,17`, outbox controller `%100`, notification routing `%98,59` statement.
- Deno format/check ve push worker testleri: **15/15 geçti**.
- `npm run verify` bütün zinciriyle geçti: typecheck, lint, format, 233 modül/948 bağımlılık mimari kontrolü, Knip, statik guard'lar ve Jest temizdir.
- Expo Doctor **20/20**, production dependency audit ve statik release kontrolü geçti.
- Android debug APK yeniden üretildi: 235.438.640 bayt, `arm64-v8a/x86/x86_64`, APK Signature Scheme v2 debug imzası, SHA-256 `117B3391CC48064D57E4EBC6F8E8FE3F08F57352FF760DC2B5DAC90398CE092F`. Bu production signing kanıtı değildir.

## 2026-08-30 tarihsel yerel sonuç

2026-08-30 yerel Docker koşusunda o tarihteki 53 migration sıfırdan uygulandı, `public` lint 0 bulgu verdi ve dört dosyada 174/174 pgTAP geçti. Bu tarihsel baseline, 2026-08-31 envanterini veya mevcut commit'in aynı-SHA sonucunu temsil etmez.

## 2026-08-31 güncel yerel sonuç

- 2026-08-31 repo envanteri **55 migration**, **5 pgTAP dosyası** ve toplam **251 planlı kontrol**tü.
- Compose profil doğrulaması, container contract paketi, Toxiproxy resilience ve `10 VU / 10 saniye` bounded sentetik k6 koşusu yerelde geçti. Sentetik yük sonucu staging kapasitesi veya production SLO kanıtı değildir.
- Canonical Supabase `docker:test` profilinin tamamlanmış aynı-SHA artifact'ı ve GitHub `docker-validation.yml` sonucu bu kayıt yazılırken bağlı değildir; bunlar eksikken migration/lint/pgTAP ya da supply-chain işleri için PASS iddiası kurulmaz.

## 2026-09-03 güncel yerel sonuç

Aynı yerel ağaçta (`chore/aaa-mvp-hardening-docker-cloudflare-ota-push`) çalıştırılan kapılar:

| Kapı                                     | Komut                             | Sonuç                                                      |
| ---------------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| Ürün yüzeyi dondurma                     | `npm run feature-freeze`          | Geçti: 5 tab, 43 stack route, 39 ekran, 26 public tablo    |
| Release evidence testleri                | `npm run release:evidence:test`   | 29/29 geçti                                                 |
| Compose sözleşmesi                       | `npm run docker:config`           | Geçti                                                       |
| Mobil zincir                             | `npm --prefix mobile run verify`  | Geçti; Jest **49 suite / 320 test**                        |
| Erişilebilirlik guardı + self-test       | `accessibility:guards(:test)`     | 74 ekran dosyası temiz; 8/8 self-test                      |
| Tasarım tokenı guardı + self-test        | `tokens:guards(:test)`            | 143 kaynak dosyası ham renksiz; 7/7 self-test              |
| Cloudflare Worker                        | `npm run check` (edge)            | typecheck/lint/format temiz; vitest **32/32**              |
| Edge Function kapısı                     | `deno fmt/lint/check/test`        | 21 dosya format, 12 dosya lint, 6 giriş type-check, 68/68  |
| Canonical Supabase Docker profili        | `npm run docker:test`             | Geçti: **57 migration** replay, `public` lint 0 bulgu, **7 dosya / 283 pgTAP**, dump/restore, Edge/Worker/upstream contract |

> Bu koşu yerel Docker ve yerel toolchain kanıtıdır. `gitTreeClean` alanı `false` olduğu için aynı-SHA release kanıtı sayılmaz; aynı-SHA kanıt yalnız temiz ağaçta üretilen `docker-validation.yml` ve `mobile-ci.yml` artifact'larıyla bağlanır.

## Dış kanıt bekleyen kapılar

Remote staging migration/lint/pgTAP, gerçek staging E2E, 25→250→10K load, fiziksel cihaz/VoiceOver/TalkBack/gerçek push, signed AAB/IPA, Sentry production ve store-console kanıtları tamamlanmadan release kararı **NO-GO** kalır.

Komut, prerequisite, artifact yolu ve PASS/FAIL ölçütleri [release-evidence-runbook.md](release-evidence-runbook.md) belgesindedir. Mock, statik inceleme veya geçmiş smoke sonucu bu dış kapıların yerine geçmez.

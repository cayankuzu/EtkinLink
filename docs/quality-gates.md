# Kalite kapıları ve dürüst kapsam

## Otomatik kapılar

- `npm run verify`: TypeScript strict, ESLint, Prettier, Dependency Cruiser, Knip, güvenlik/uyumluluk/performans guard'ları, kritik akış referansları ve Jest.
- Jest tüm `src` dosyalarını coverage kapsamında tutar. Kapsam listesi daraltılmaz.
- Jest global eşik havuzu statement `%36`, branch `%27`, function `%26`, line `%37` altında fail olur. Dosya-bazlı eşikler nedeniyle bu havuzun güncel sonucu sırasıyla `%37,02 / %27,71 / %26,90 / %38,39`dur.
- Ayrı ratchet tüm-dosya kapsamını `%38 / %28 / %28 / %39` altına düşürmez; 17 değişen kritik uygulama/güvenlik modülünü ayrı sabit tabanlarla denetler.
- `chatOutbox`, `compatibility` ve `roomRules` için Jest dosya eşikleri; daha geniş kritik modül listesi için `coverage:ratchet` fail-closed'dur.
- pgTAP paketi 34 kontrolle anon/auth/service rol ayrımını, RLS/IDOR'u, `auth.users` görünmezliğini, storage/account-delete sınırlarını, enqueue dedupe'yi, push claim yetkilerini, mesaj idempotency ve rate-limit davranışını doğrular.
- Deno kapısı tüm Edge Function girişlerini format/type-check eder ve 15 push worker testini çalıştırır.
- Production dependency audit allowlist dışı high/critical bulguda durur. Yaması bulunmayan iki `image-size` advisory zinciri geçici allowlist altındadır.
- Release evidence kapısı aynı commit mobil CI artifact'ı, son 7 gün staging E2E artifact'ı ve son 30 gün 10K staging load artifact'ı arar.

## 2026-08-19 yerel sonuç

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

## Dış kanıt bekleyen kapılar

Docker kullanılmadı. Remote staging migration/lint/34 pgTAP, gerçek staging E2E, 25→250→10K load, fiziksel cihaz/VoiceOver/TalkBack/gerçek push, signed AAB/IPA, Sentry production ve store-console kanıtları tamamlanmadan release kararı **NO-GO** kalır.

Komut, prerequisite, artifact yolu ve PASS/FAIL ölçütleri [release-evidence-runbook.md](release-evidence-runbook.md) belgesindedir. Mock, statik inceleme veya geçmiş smoke sonucu bu dış kapıların yerine geçmez.

# Hardcode ve DRY raporu

Bu rapor, mevcut kaynak ağacında ölçülen tekrar ve sabit-değer dağılımını, yapılan merkezileştirmeleri ve bunları koruyan fail-closed guard'ları kaydeder. Yeni soyutlama katmanı eklenmemiştir; yalnız gerçekten üç ya da daha fazla yerde tekrarlanan veya sessizce sürüklenen değerler tek kaynağa taşınmıştır.

## Ölçülen envanter

| Ölçüm | Değer |
| ----- | ----- |
| Üretim kaynağı (`mobile/src`, test dışı) | 142 dosya / 26.349 satır |
| Test kaynağı | 48 dosya / 7.647 satır |
| Supabase Edge Function kaynağı | 12 dosya |
| Cloudflare Worker kaynağı | 5 dosya |
| Migration | 57 |
| Modül bağımlılık grafiği | 245 modül / 1.006 bağımlılık, ihlal yok |
| Kullanılmayan export/dosya (`knip`) | 0 |
| `TODO`/`FIXME`/`HACK` | 0 |
| Boş `catch` bloğu | 0 |

## Merkezî kaynaklar

| Değer sınıfı | Tek kaynak |
| ------------ | ---------- |
| Renk, spacing, radius, tipografi, gölge, layout ölçüleri | `mobile/src/shared/theme/tokens.ts` |
| Sayfa boyutları ve içerik sınırları | `mobile/src/shared/constants/limits.ts` |
| Ortam değerleri ve şema doğrulaması | `mobile/src/shared/config/env.ts` |
| Sorgu anahtarları | `mobile/src/shared/lib/queryKeys.ts` |
| Hata sınıflandırma ve kullanıcı kopyası | `mobile/src/shared/lib/errors.ts` |
| Telemetri ve redaksiyon | `mobile/src/shared/lib/telemetry.ts` |
| Ağ zaman aşımı / iptal / retry | `mobile/src/shared/lib/network.ts` |
| Outbox durumu ve sınırları | `mobile/src/shared/lib/chatOutbox.ts` |

## Kapatılan bulgular

### 1. Renk literalleri (18 tekrar, 6 dosya)

Tema dışında 18 ham renk vardı ve zaten sürüklenmişti:

- aynı tam ekran fotoğraf görüntüleyicisi için **iki farklı** siyaha yakın zemin (`#050505`, `#090C14`);
- fotoğrafın üzerinde duran kontroller için **dört farklı** beyaz alfa (`0.72`, `0.86`, `0.92`, `0.94`);
- mevcut `overlay` tokenının **iki birebir kopyası** (`rgba(16, 24, 40, 0.56)`);
- adlandırılmamış swipe tint'leri ve bir tehlike kenarlığı.

Yapılan: rolleri adlandıran tokenlar eklendi (`mediaCanvas`, `overlaySubtle`, `dangerBorder`, `glassSurface`, `glassBorderSoft`, `glassBorderStrong`, `likeOverlay`, `passOverlay`) ve 18 çağrı yeri bunlara bağlandı. Değerler korundu; yalnız iki algılanamaz birleştirme yapıldı (`0.94 → 0.92` cam yüzey, `#090C14 → #050505` medya zemini). Palet, spacing, tipografi veya yerleşim yeniden tasarlanmadı.

### 2. Sayfa boyutu literalleri (3 tekrar)

`messageService` ve `roomService` `paginationLimits`'i içe aktarıp bir istek için kullanıyor, hemen yanında aynı sayfa boyutunu (`35`) elle yazıyordu — yani thread sayfa boyutu aynı anda üç yerde vardı ve bire bir sohbet ile oda sohbeti arasında sürüklenebilirdi. `roomParticipantsService` roster'ını adsız bir `200` ile sınırlıyordu.

Yapılan: üçü de `paginationLimits`'e bağlandı; kodun zaten uyguladığı roster sınırı için `roomParticipants` sabiti eklendi.

### 3. Ham hata nesnelerinin konsola yazılması (6 çağrı yeri)

Altı çağrı yeri `console.warn(mesaj, error)` biçiminde ham sağlayıcı hatası yazıyordu. Release derlemesi konsol çıktısını logcat/os_log'a iletmeye devam eder; bu, Expo push tokenını, imzalı Storage URL'sini veya PostgREST satır parçasını log erişimi olan her şeye açardı. Aynı dosya ailesinde iki farklı örüntü vardı: `useAuthBootstrap` doğru biçimde yalnız `toAppError(error).code` yazıyordu, diğerleri ham nesneyi.

Yapılan: `telemetry.warnRedacted` tek yetkili konsol yazıcısı oldu; sabit mesajı sanitize eder ve yalnız kararlı `AppError` kodunu ekler. Altı çağrı yeri buna bağlandı.

### 4. Supabase CLI sürüm sürüklenmesi

`mobile-ci.yml` 2.115.0, Docker doğrulama profili 2.116.0 pinliyordu; aynı migration replay / DB lint / pgTAP kapısı iki farklı toolchain'de koşuyordu. İkisi 2.116.0'a hizalandı.

## Kalıcı guard'lar

| Guard | Kural | Self-test |
| ----- | ----- | --------- |
| `check-hardcoded-values.mjs` | `src/` içinde hex/rgb/rgba/hsl/hsla yok (istisna: tema modülü); `.limit(<n>)`, `page_size: <n>`, `pageSize: <n>` yok (istisna: limits modülü) | 11 |
| `check-accessibility-guards.mjs` | Her dokunma hedefi ya rol+ad taşır ya da açıkça `accessible={false}` | 8 |
| `check-security-guards.mjs` | `src/` içinde `telemetry.ts` dışında `console.*` yok; CI/Docker Supabase CLI sürümleri eşleşir; owner-scoped RPC ACL sözleşmesi pgTAP'te korunur | ihlal enjekte edilerek doğrulandı |
| ESLint `no-console` | `error`, tek override `src/shared/lib/telemetry.ts` | — |
| `dependency-cruiser` | Katman yönü ve döngü yasağı | — |
| `knip` | Ölü export/dosya yok | — |

Her guard `npm --prefix mobile run verify` ve `mobile-ci.yml` içindeki `quality` işinde fail-closed çalışır.

## Bilinçli olarak merkezileştirilmeyenler

Prompt'un "her `16`, `8` veya `300` değerini anlamsız global sabit yapma" kuralı uygulanmıştır:

- tek kullanımlık yerleşim değerleri ilgili `StyleSheet` içinde kalır;
- bir kez kullanılan animasyon süreleri ve gecikmeler (`delayLongPress={500}` gibi) çağrı yerinde okunur kalır;
- `zod` şema sınırları `contentLimits`'ten okunur, ancak şemaya özel iş kuralları şemada kalır;
- tek implementasyonu olan servisler için interface üretilmemiştir; test dikişi doğrudan enjeksiyonla sağlanır.

## Doğrulama

Aynı yerel ağaçta çalıştırılan komutlar ve sonuçları [quality-gates.md](quality-gates.md) içindeki `2026-09-04 güncel yerel sonuç` tablosundadır.

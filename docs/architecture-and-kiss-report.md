# Mimari ve KISS raporu

Bu rapor, mevcut mimarinin ölçülen durumunu ve bu hardening turunda **eklenmeyen** karmaşıklığı kaydeder. Mimari anlatımın kendisi [architecture.md](architecture.md) belgesindedir; burada yalnız ölçüm, sınır kanıtı ve sadelik kararları vardır.

## Ölçülen yapı

| Ölçüm | Değer |
| ----- | ----- |
| Mobil üretim kaynağı | 142 dosya / 26.349 satır |
| Mobil test kaynağı | 48 dosya / 7.647 satır (test/üretim oranı ≈ %29) |
| Modül grafiği | 245 modül / 1.006 bağımlılık |
| Bağımlılık ihlali | 0 (`dependency-cruiser`) |
| Döngüsel bağımlılık | 0 |
| Ölü export/dosya | 0 (`knip`) |
| 300 satırı aşan üretim dosyası | 24 |
| 500 satırı aşan üretim dosyası | 11 |
| Supabase Edge Function | 6 fonksiyon / 12 kaynak dosyası |
| Cloudflare Worker | 5 kaynak dosyası |
| Migration | 57 (forward-only) |
| pgTAP | 7 dosya / 283 planlı kontrol |
| GitHub workflow | 11 |

## Bağımlılık yönü

`mobile/.dependency-cruiser.cjs` kuralları CI'da fail-closed çalışır ve şu yönü zorlar:

```text
app (navigasyon/bileşim)
  → features (ekran + controller/hook + servis)
    → shared (tasarım sistemi, ağ, depolama, tipler)
      → platform (Supabase, Expo, React Native)
```

Doğrulanan sınırlar:

- `shared` hiçbir `features` modülünü içe aktarmaz;
- bir feature başka bir feature'ın ekranını veya iç bileşenini içe aktarmaz; paylaşım `shared` üzerinden yapılır;
- domain tipleri (`shared/types/domain.ts`) UI framework'üne bağımlı değildir;
- `service_role` yalnız Edge Function tarafındadır; mobil bundle'a girmez.

## 500 satırı aşan dosyalar — tek tek gerekçe

Mekanik bölme yapılmamıştır. Her büyük dosya kohezyon ve test edilebilirlik açısından tek tek değerlendirilmiştir.

| Dosya | Satır | Karar |
| ----- | ----: | ----- |
| `features/events/rssEventService.ts` | 980 | Tek sorumluluk: güvenilmeyen RSS/JSON'un ayrıştırılması ve normalizasyonu. Bölünmesi güvenlik sınırını dağıtır; kapsamı kendi test dosyasıyla korunur. |
| `features/messages/DirectChatScreen.tsx` | 807 | Presence/typing `useConversationPresence`'a, balon ve besteci ayrı bileşenlere çıkarılmış; kalan kısım ekran kompozisyonudur. |
| `features/rooms/RoomDetailScreen.tsx` | 768 | Realtime yaşam döngüsü `useRoomRealtime`'a, mesaj sunumu `RoomMessageBubble`'a çıkarılmış. |
| `shared/types/database.ts` | 729 | Üretilmiş Supabase şema tipi. Elle bölünmez. |
| `features/events/EventDetailScreen.tsx` | 689 | Sorgu/mutasyon/cache/modal durumu `useEventDetailController`'da; ekran kompozisyondur. |
| `features/matching/MatchingLikesScreen.tsx` | 607 | Liste + iki sekme durumu; ortak kart bileşenleri ayrık. |
| `features/matching/MatchCardsScreen.tsx` | 607 | Gesture/Reanimated sorumluluğu `useMatchCardGesture`'da; kart ve kota sunumu saf bileşenlerde. |
| `features/events/EventFiltersScreen.tsx` | 596 | Tek ekranlık filtre formu; alanları bölmek durumu dağıtırdı. |
| `features/matching/MatchHubScreen.tsx` | 573 | Sekme kompozisyonu; alt ekranlar ayrı dosyalarda. |
| `shared/lib/pushNotifications.ts` | 536 | Token yaşam döngüsü tek yerde tutulur; bölünmesi yarış koşullarını iki dosyaya yayardı. |
| `features/profile/profileService.ts` | 511 | Profil okuma/yazma/medya imzalama; her biri ayrı export ve ayrı testlidir. |

## Bu turda eklenmeyenler (KISS kanıtı)

Prompt'un izin verdiği fakat **ölçülmüş ihtiyaç olmadığı için eklenmeyen** yapılar:

| Aday | Karar | Gerekçe |
| ---- | ----- | ------- |
| Cloudflare D1 / KV ikinci veri kaynağı | Eklenmedi | PostgreSQL tek doğruluk kaynağı kalır |
| Cloudflare Queues | Eklenmedi | Mevcut Supabase outbox (`notification_events` + `notification_deliveries`) aynı işi lease/retry/DLQ ile zaten yapıyor; Queue ikinci teslim yolu yaratırdı |
| Durable Objects | Eklenmedi | Realtime Supabase'te; sayaçlar PostgreSQL transaction'ında |
| R2 medya taşıması | Eklenmedi | Private medya imzalı Storage'da kalır; ölçülmüş maliyet/performans faydası yok |
| Redis / Kafka / microservice | Eklenmedi | Ölçülmüş darboğaz yok |
| DI container | Eklenmedi | Constructor/parametre enjeksiyonu test dikişi için yeterli |
| Tek implementasyonlu servisler için interface | Eklenmedi | Doğrudan modül mock'u yeterli |
| Yeni durum yönetimi kütüphanesi | Eklenmedi | TanStack Query (sunucu) + Zustand (oturum/istemci) ayrımı tutarlı |
| Paylaşılan telemetry mock modülü | Eklenmedi | Üç test dosyasında tek satırlık mock girdisi, alias altyapısından ucuz |

Bu turda eklenen tek yeni altyapı, mevcut akışları koruyan fail-closed guard'lar ve bunların self-test'leridir; hiçbiri çalışma zamanı kodu değildir.

## Bu turda eklenen mimari sınırlar

| Sınır | Nerede | Neden |
| ----- | ------ | ----- |
| `service_role` hiçbir owner-scoped client RPC'sini çalıştıramaz | `supabase/migrations/20260903090000_owner_scoped_rpc_role_acl_hardening.sql` + `supabase/tests/rpc_role_acl_contract.sql` | Supabase varsayılan ayrıcalıkları her yeni fonksiyona sessizce `anon` ve `service_role` EXECUTE veriyordu; backend kimliği kullanıcı gibi davranamamalı |
| `anon` yalnız kayıt öncesi ve public katalog uçlarını çalıştırabilir | aynı migration/test | Mutasyon RPC'leri ACL düzeyinde de fail-closed olmalı, yalnız `auth.uid()` mantığıyla değil |
| Konsola yalnız redaksiyonlu telemetry yardımcısı yazabilir | `telemetry.warnRedacted` + ESLint + `check-security-guards.mjs` | Release log'u cihazda okunabilir |
| Dokunma hedefi ya erişilebilir kontroldür ya da açıkça değildir | `check-accessibility-guards.mjs` | iOS gruplama davranışı sessizce kontrolleri gizliyordu |
| Renk ve sayfa boyutu literali yasak | `check-hardcoded-values.mjs` | Değerler zaten sürüklenmişti |
| CI ve Docker aynı Supabase CLI'ını kullanır | `check-security-guards.mjs` | Aynı DB kapısı iki toolchain'de koşuyordu |

## Okunabilirlik

- İsimlendirme tutarlıdır: bileşenler `PascalCase.tsx`, hook'lar `useX.ts`, servisler `xService.ts`, guard'lar `check-*.mjs`.
- Klasör derinliği en fazla 4 seviyedir (`src/features/<domain>/<file>`).
- Kopya ve hata mesajları Türkçedir; ham backend mesajı UI'ye taşınmaz.
- Yorumlar "ne" değil "neden" açıklar; bu turda eklenen her yorum bir davranış tuzağını (iOS erişilebilirlik gruplaması, Supabase varsayılan ayrıcalıkları, release log hedefi) belgeler.

## Doğrulama

| Kontrol | Sonuç |
| ------- | ----- |
| `npm --prefix mobile run architecture` | 245 modül / 1.006 bağımlılık, ihlal yok |
| `npm --prefix mobile run deadcode` | temiz |
| `npm --prefix mobile run typecheck` | strict, hata yok |
| `npm --prefix mobile run lint` | 0 uyarı |
| `npm --prefix mobile run test` | 50 suite / 330 test |
| `npm run docker:test` | 57 migration replay, `public` lint 0 bulgu, 7 dosya / 283 pgTAP, dump/restore, Edge/Worker contract |

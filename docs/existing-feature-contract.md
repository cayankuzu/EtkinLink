# EtkinLink mevcut özellik sözleşmesi

Bu sözleşmenin makinece dondurulmuş kökü `f8a1e48de47d49021ea092c609440240fd13e23d`, bu hardening görevinin güncel `origin/main` başlangıcı ise `20dc22c76174ab7a9c1a2fae79ed89e45597b57e` commit'idir. Makinece karşılığı `quality/feature-surface.snapshot.json` dosyasıdır. Tarihsel kök guard karşılaştırması için korunur; güncel repo gerçeğini `aaa-mvp-baseline.md` ve `release-readiness.md` kaydeder. Bu çalışma mevcut kullanıcı kapsamını büyütmez.

## Kullanıcı yüzeyleri

| Alan           | Mevcut ekranlar ve kullanıcı işi                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth/kayıt     | Welcome, SignIn, SignUp, profil/ilgi/fotoğraf/inceleme adımları, e-posta doğrulama, şifre sıfırlama ve yeni şifre                                  |
| Etkinlikler    | Keşfet, şehir, arama, mevcut filtreler, etkinlik detayı ve kaydedilen etkinlikler                                                                  |
| Odalar         | Katılınan odalar, oda mesajları, katılımcılar ve aynı etkinliğin mevcut eşleşme akışları                                                           |
| Eşleşme        | Beğeni listesi, aday kartları, mevcut filtreler ve eşleşme profili düzenleme                                                                       |
| Mesajlar       | Konuşma listesi, bire bir sohbet ve mevcut sohbet ayarları                                                                                         |
| Profil/ayarlar | Profil, profil düzenleme, fotoğraflar, ilgi alanları, görünürlük, eşleşme filtresi, şifre, ayarlar, yasal metinler, engellenenler ve public profil |

Alt gezinmede yalnız `DiscoverTab`, `RoomsTab`, `MatchesTab`, `MessagesTab` ve `ProfileTab` vardır. Altı stack'te 43 route, 39 `*Screen.tsx` entrypoint ve mevcut ekranların içinde 15 modal kullanımı vardır. Kesin adlar snapshot'ta tutulur.

## Mevcut backend sözleşmesi

- Supabase Auth; PostgreSQL/RLS/RPC; private Realtime; private `profile-photos` Storage ana sistemdir.
- Mobil istemcinin mevcut Edge Function çağrıları `delete-account` ve `etkinlik-api`dir.
- Operasyon/background işlevleri `ingest-events`, `push-dispatch`, `push-receipts` ve `sync-event`tir.
- Başlıca atomik RPC'ler: etkinliğe katıl/ayrıl/kaydet; oda/DM gönder ve okundu işaretle; matching swipe/like/pass; block/unblock/end/delete; raporlama; profil/fotoğraf/ilgi güncelleme; push token kayıt/iptal.
- 26 public tablo snapshot'ta adlarıyla kayıtlıdır. `notification_events`, `notification_deliveries` ve `push_tokens` ürün verisinin ana kaynağı değil, mevcut push teslim altyapısıdır.

## Bildirim, deep link, izin ve capability sözleşmesi

- Mevcut bildirim türleri: `new_like`, `new_match`, `direct_message`, `room_message`, `match_ended`, `event_reminder`, `system`, `blocked`, `unblocked`.
- `blocked` ve `unblocked` yeni bildirim türleri değildir: ilk production schema'daki `public.notification_kind` enum'u, feature-surface snapshot'ı, mobil yönlendirme kodu ve mevcut `private.notify_match_change` trigger'ı bu iki türü zaten içerir. Forward-only CHECK onarımı yalnız durable outbox'ı bu mevcut sözleşmeyle eşitler.
- Mevcut route türleri: `match`, `room`, `likes`, `event`; Android kanalları: messages, rooms, matches, events, system.
- Teslim zinciri `notification_events` outbox'ı → ticket kaydı → receipt lease'i → `delivered`, `invalid_token`, `retryable` veya `permanent_failure` durumudur. Receipt retry en çok beş kalıcı attempt tüketir; exhausted/permanent kayıtlar logical DLQ olarak yalnız service-role sorgu ve auditli replay RPC'siyle yönetilir.
- Deep link scheme `etkinlink`; auth callback ve reset-password path'leri kullanılır.
- Android izinleri: INTERNET, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, VIBRATE.
- iOS: photo library kullanım açıklaması ve APNs entitlement. Uygulama portrait telefondur; tablet ürün yüzeyi değildir.

## Ayarlar yüzeyi

Mevcut gruplar `PROFİL`, `GÜVENLİK VE DESTEK`, `HESAP İŞLEMLERİ`dir. Mevcut satırlar profil düzenleme/görünürlük/eşleşme durumu/eşleşme filtresi/şifre, bildirim izni/engellenenler/yasal ve çıkış/hesap silmedir. Yeni grup veya CTA bu çalışma kapsamında değildir.

## Açıkça kapsam dışı

Yeni ekran, tab, route, onboarding adımı, notification type, ayar grubu, admin/moderatör paneli, ödeme/premium, takvim/reminder, QR, waitlist, doğrulama rozeti, dark mode, saved search, yeni filtre/kategori/içerik türü ve public web ürün sayfası eklenmez. Cloudflare/OTA/ops route ve tabloları yalnız mevcut akışların güvenliği, dağıtımı ve dayanıklılığı için kullanılabilir.

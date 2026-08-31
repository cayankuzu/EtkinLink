# EtkinLink mevcut özellik sözleşmesi

Bu sözleşme `f8a1e48de47d49021ea092c609440240fd13e23d` başlangıç commit'inden çıkarıldı. Makinece karşılığı `quality/feature-surface.snapshot.json` dosyasıdır. Bu çalışma mevcut kullanıcı kapsamını büyütmez.

## Kullanıcı yüzeyleri

| Alan | Mevcut ekranlar ve kullanıcı işi |
| --- | --- |
| Auth/kayıt | Welcome, SignIn, SignUp, profil/ilgi/fotoğraf/inceleme adımları, e-posta doğrulama, şifre sıfırlama ve yeni şifre |
| Etkinlikler | Keşfet, şehir, arama, mevcut filtreler, etkinlik detayı ve kaydedilen etkinlikler |
| Odalar | Katılınan odalar, oda mesajları, katılımcılar ve aynı etkinliğin mevcut eşleşme akışları |
| Eşleşme | Beğeni listesi, aday kartları, mevcut filtreler ve eşleşme profili düzenleme |
| Mesajlar | Konuşma listesi, bire bir sohbet ve mevcut sohbet ayarları |
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
- Mevcut route türleri: `match`, `room`, `likes`, `event`; Android kanalları: messages, rooms, matches, events, system.
- Deep link scheme `etkinlink`; auth callback ve reset-password path'leri kullanılır.
- Android izinleri: INTERNET, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, VIBRATE.
- iOS: photo library kullanım açıklaması ve APNs entitlement. Uygulama portrait telefondur; tablet ürün yüzeyi değildir.

## Ayarlar yüzeyi

Mevcut gruplar `PROFİL`, `GÜVENLİK VE DESTEK`, `HESAP İŞLEMLERİ`dir. Mevcut satırlar profil düzenleme/görünürlük/eşleşme durumu/eşleşme filtresi/şifre, bildirim izni/engellenenler/yasal ve çıkış/hesap silmedir. Yeni grup veya CTA bu çalışma kapsamında değildir.

## Açıkça kapsam dışı

Yeni ekran, tab, route, onboarding adımı, notification type, ayar grubu, admin/moderatör paneli, ödeme/premium, takvim/reminder, QR, waitlist, doğrulama rozeti, dark mode, saved search, yeni filtre/kategori/içerik türü ve public web ürün sayfası eklenmez. Cloudflare/OTA/ops route ve tabloları yalnız mevcut akışların güvenliği, dağıtımı ve dayanıklılığı için kullanılabilir.

# EtkinLink mimarisi

## Mobil istemci

İstemci feature-first ve KISS odaklıdır:

- `src/app`: uygulama bileşimi ve navigasyon
- `src/features`: auth, onboarding, events, rooms, matching, messages, profile ve notifications
- `src/shared`: tasarım sistemi, Supabase istemcisi, güvenli depolama, ortak tipler ve küçük yardımcılar

Sunucu verisi TanStack Query ile, oturum ve küçük istemci durumları Zustand ile yönetilir. Navigasyon tip güvenlidir. Büyük listeler FlashList ve cursor pagination kullanır. Bileşenler doğrudan başka feature'ın ekranına bağımlı değildir; bağımlılık kuralları `dependency-cruiser` ile CI'da denetlenir.

Sorgu anahtarları domain bazlı `queryKeys` fabrikalarında tutulur. Kritik query function'ları React Query `AbortSignal` değerini Supabase builder'a iletir; ortak fetch katmanı 15 saniye timeout, ekran iptali ve en çok iki jitter'lı retry uygular.

Büyük akışlar dosya sayısı için değil sorumluluk sınırları için ayrılır:

- Event detail sorgu/mutation/cache/modal/navigasyon durumu `useEventDetailController` içindedir; ekran view kompozisyonudur ve kaynak detayları saf section bileşenidir.
- Room detail, Realtime/typing yaşam döngüsünü `useRoomRealtime`; mesaj sunumunu `RoomMessageBubble`; besteci alanını ortak `ChatComposer` üzerinden kullanır.
- Direct chat, presence/typing'i `useConversationPresence`; balon ve composer sunumunu ayrı bileşenlerde tutar.
- Match cards gesture/Reanimated sorumluluğunu `useMatchCardGesture`; kart ve quota sunumunu saf bileşenlerde tutar.

## Backend

Supabase Auth, PostgreSQL, Storage, Realtime ve Edge Functions kullanılır. Kritik mutasyonlar istemciden tabloya doğrudan yazmak yerine `security definer` RPC'lerinde atomik olarak yürür:

- etkinliğe katılma/ayrılma
- etkinlik özelinde beğenme/geçme ve eşleşme
- bire bir/oda mesajı gönderme
- engelleme, eşleşmeyi bitirme ve sohbeti silme
- raporlama
- 3–6 profil fotoğrafını ve 3–12 ilgi alanını atomik değiştirme
- hesabı silme

Çift kimlikleri deterministiktir. Eşleşme ve mesaj idempotency anahtarları tekrar dokunma/ağ tekrarında çift kayıt oluşmasını önler. Mesaj listeleri `(created_at, id)` cursor'ı kullanır.

## Oda yaşam döngüsü

- Etkinlik başlangıcından 13 gün önce yazmaya açılır.
- Etkinlik bitiminden 3 gün sonrasına kadar yazılabilir.
- Sonrasında arşivlenir; katılımcılar geçmişi kalıcı olarak okuyabilir.
- Katılmamış kullanıcı oda mesajlarını okuyamaz.

## Eşleşme sınırı

Eşleşme yalnızca aynı etkinliğe katılan, eşleşmesini açmış ve profil şartlarını tamamlamış kullanıcılar arasında oluşur. Profil şartı: doğrulanmış e-posta, 18+, biyografi, 3–6 fotoğraf ve 3–12 ilgi alanı.

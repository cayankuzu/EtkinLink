# Cihaz ve erişilebilirlik matrisi

## Kapsam kararı

Bu sürüm bilinçli olarak telefon, portrait ve açık tema kapsamındadır. iPad/tablet desteği mağazada vaat edilmez: iOS `supportsTablet=false` ve device family `1`; Android `largeScreens=false`, `xlargeScreens=false`, `resizeableActivity=false` kullanır. Uygulama içeriği telefonda 640dp, modal/sheet içerikleri 520dp ile sınırlandırılır.

## Zorunlu fiziksel doğrulama

| Sınıf                 | Hedef                      | Kontroller                                                | Durum                                      |
| --------------------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| Küçük iPhone          | Desteklenen en küçük ekran | Auth, klavye, modal, uzun Türkçe metin, Dynamic Type %200 | Bekliyor                                   |
| Büyük iPhone          | Güncel büyük ekran         | Etkinlik detayı, eşleştirme, oda/DM, sheet genişliği      | Bekliyor                                   |
| Android küçük         | 360dp, API 24+             | Auth, keyboard resize, geri hareketi, bildirim izni       | Bekliyor                                   |
| Android orta          | 411dp, API 34+             | Kritik akışlar, font scale 2.0, offline/reconnect         | Emulator CI hazır; fiziksel cihaz bekliyor |
| Android geniş telefon | 480dp                      | Maksimum içerik genişliği, modal, touch target            | Bekliyor                                   |

Her satırda portrait, sistem font ölçeği 1.0 ve 2.0, ekran okuyucu etiketleri, klavye açık/kapalı, düşük ağ ve uygulama yeniden başlatma kontrol edilir. Push için ön plan, arka plan ve uygulama kapalı teslimi ayrıca gerçek cihazda denenir.

## Zorunlu push yaşam döngüsü matrisi

Her vaka hem Android hem iOS fiziksel cihazda, aynı signed staging SHA/runtime/channel ile çalıştırılır. Kayıtta yalnız sentetik kullanıcı alias'ı, hashlenmiş notification/event kimliği ve redacted DB durumu bulunur; push tokenı, title/body/payload ve provider credential kaydedilmez.

| Vaka                      | Beklenen sonuç                                                                                     | Zorunlu kanıt                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Foreground delivery       | Mevcut banner/list davranışı; tek event ve tek delivery                                            | Ekran kaydı + redacted event/ticket/receipt geçişi                |
| Background delivery + tap | İlgili mevcut `match`, `room`, `likes` veya `event` route'una bir kez gider                        | Önce/sonra route + notification identifier hash'i                 |
| Terminated cold-start tap | Navigation hazır olduğunda route uygulanır; duplicate response yutulur                             | Cold-start video + uygulama logunda PII'siz karar                 |
| Signed-out tap            | Route auth sonrasına ertelenir; yetkisiz içerik açılmaz                                            | Signed-out ve sign-in sonrası route kanıtı                        |
| Permission deny/revoke    | Yeni token kaydı yoktur; mevcut token server-side pasifleşir                                       | OS permission + `disabled_at` redacted sorgusu                    |
| Token rotation/reinstall  | Yeni token kaydolur, önceki token aktif claim'e girmez                                             | Önce/sonra token hash'i + project/platform/app version            |
| `DeviceNotRegistered`     | Receipt terminal `invalid_token`; token aynı transactionda pasif                                   | Redacted receipt/RPC sonucu                                       |
| Expo outage/429/5xx       | Her worker çalışması bounded attempt tüketir; beşinci deneme DLQ olur                              | Attempt, lease ID hash'i, next-attempt ve terminal kod            |
| Yanlış/stale lease        | Geç kalan worker sonucu reddedilir ve yeni state ezilmez                                           | RPC `false` + değişmeyen attempt/state                            |
| Offline logout            | Eski hesaba ait push kilit ekranına düşmez                                                         | Logout öncesi/sonrası teslim deneyi; kalan risk açıkça kaydedilir |
| Account deletion          | Token/event/delivery kullanıcı FK zincirinden temizlenir                                           | PII'siz aggregate count                                           |
| Block/unmatch             | Block sonrası inflight/eski message push görünmez; mevcut `blocked/unblocked` contractı tekilleşir | Match state + dedupe count + cihaz teslimi                        |

Her platformda en az birer `match`, `room`, `likes`, `event` route'u ve route'suz `system` bildirimi denenir. Foreground/background/terminated satırlarının yalnız “teslim edildi” ekran görüntüsü yeterli değildir; tap routing ve DB ticket/receipt durumu aynı UTC zaman penceresiyle eşleştirilir.

Kanıt dizini `artifacts/device-matrix/<sha>/push/` olmalıdır. `manifest.json` cihaz modeli, OS, build hash, app version, runtime, channel, network, permission state, app state, vaka kimliği, UTC başlangıç/bitiş, redacted artifact yolları, tester ve reviewer alanlarını içerir. Eksik platform/vaka `PASS` sayılmaz.

Statik compatibility guard dört Android ABI'sini (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`), telefon ekran bildirimlerini ve portrait kararını doğrular. Bu statik sonuç fiziksel cihaz kanıtının yerine geçmez.

2026-08-19 yerel kontrolde ADB listesinde bağlı cihaz/emülatör yoktu. Bu nedenle fiziksel Android satırları, TalkBack ve gerçek push teslimi çalıştırılmadı. iOS fiziksel test ve signed build için macOS/Xcode/EAS ortamı ayrıca gereklidir.

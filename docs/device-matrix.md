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

Statik compatibility guard dört Android ABI'sini (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`), telefon ekran bildirimlerini ve portrait kararını doğrular. Bu statik sonuç fiziksel cihaz kanıtının yerine geçmez.

2026-08-19 yerel kontrolde ADB listesinde bağlı cihaz/emülatör yoktu. Bu nedenle fiziksel Android satırları, TalkBack ve gerçek push teslimi çalıştırılmadı. iOS fiziksel test ve signed build için macOS/Xcode/EAS ortamı ayrıca gereklidir.

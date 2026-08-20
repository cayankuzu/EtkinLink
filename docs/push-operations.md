# Push operasyonları

## Çalışma modeli

- Veritabanı tetikleri yalnızca `notification_events` outbox kaydı üretir.
- `etkinlink-push-outbox-drain` her dakika en eski kayıtları, en çok 25 olaylık batch ve `SKIP LOCKED` ile claim eder.
- `push-dispatch` en çok dört eşzamanlı Expo isteği çalıştırır; istek zaman aşımı 10 saniyedir ve geçici hatalarda jitter'lı retry uygulanır.
- Ticket oluşan teslimatlar 15 dakika sonra receipt kontrolüne girer.
- `etkinlink-push-receipts` her beş dakikada bir receipt kayıtlarını iki dakikalık lease ile claim eder. Durumlar `pending`, `delivered`, `invalid_token`, `retryable` ve `permanent_failure` şeklindedir. En çok beş deneme yapılır.
- `DeviceNotRegistered` sonucu ilgili tokenı pasifleştirir.

## Ortam yapılandırması

Staging ve production kendi Vault kayıtlarını kullanır; kaynak kodda proje URL'si veya worker secret bulunmaz.

| Vault adı                 | Değer                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `edge_functions_base_url` | İlgili ortamın HTTPS Edge Functions taban URL'si; örnek: `https://<project-ref>.supabase.co/functions/v1` |
| `push_worker_secret`      | En az 32 karakterlik rastgele worker secret                                                               |

Aynı `push_worker_secret`, `push-dispatch` ve `push-receipts` Edge Function ortamlarına da secret olarak tanımlanır. Çağrılar `x-push-worker-secret` başlığıyla doğrulanır. Secret değerleri repo, log veya destek kaydına yazılmaz.

## Dağıtım ve rotasyon

1. Migration'ları önce izole staging'e uygula.
2. Staging Vault kayıtlarını oluştur veya güncelle.
3. Edge Function secret'larını aynı değerle güncelle ve iki worker'ı deploy et.
4. Worker endpoint'ine eksik/yanlış başlıkla yapılan çağrının 401; doğru başlıkla yapılan boş drain çağrısının 2xx verdiğini doğrula.
5. Outbox, delivery ve receipt durumlarını; retry gecikmesini; geçersiz token temizliğini gözle.
6. Production rotasyonunda önce Edge Function secret'ını, hemen ardından Vault kaydını değiştir. Kısa geçiş boyunca cron'u durdur; doğrulamadan sonra yeniden etkinleştir.

## Alarm ve müdahale

- `pending` yaşının 10 dakikayı aşması, sürekli `retryable`, `MAX_ATTEMPTS_EXHAUSTED` veya worker 401 sonuçları olay olarak ele alınır.
- Önce Vault/Function secret eşitliği, cron çalışmaları, `pg_net` yanıtları ve Expo hata kodları kontrol edilir.
- Geri alma gerektiğinde cron işleri durdurulur. Outbox kayıtları silinmez; önceki çalışan Edge Function sürümü ve secret çifti geri yüklenir, ardından pending kayıtlar tekrar drain edilir.
- Gerçek cihaz teslimi; uygulama ön planda, arka planda, kapalı, token yenilenmiş ve token geçersizleşmiş durumlarda hem iOS hem Android için kanıtlanmadan push kapısı tamamlanmış sayılmaz.

Bu depoda dispatcher/receipt kodu ve zamanlama sözleşmesi hazırdır. Staging deploy, gerçek Expo/APNs/FCM receipt'i ve fiziksel cihaz teslim kanıtı henüz üretilmemiştir.

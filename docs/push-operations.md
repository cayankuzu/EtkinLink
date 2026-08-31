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

Aynı `push_worker_secret`, `push-dispatch` ve `push-receipts` Edge Function ortamlarına da secret olarak tanımlanır. `private.invoke_push_worker` exact JSON gövdesini endpoint scope'u, Unix timestamp ve UUID nonce ile HMAC-SHA256 imzalar. Worker `x-push-worker-timestamp`, `x-push-worker-nonce` ve `x-push-worker-signature: v1=<hex>` başlıklarını doğrular; nonce service-role-only `consume_push_worker_nonce` RPC'sinde atomik olarak yalnız bir kez tüketilir. Eski statik `x-push-worker-secret` çağrıları kabul edilmez. Secret veya canonical body log/destek kaydına yazılmaz.

## Dağıtım ve rotasyon

1. Migration'ları önce izole staging'e uygula.
2. Staging Vault kayıtlarını oluştur veya güncelle.
3. Edge Function secret'larını aynı değerle güncelle ve iki worker'ı deploy et.
4. Worker endpoint'ine eksik/yanlış/eski timestamp, yanlış scope/body imzası ve tekrar kullanılan nonce ile yapılan çağrıların 401 verdiğini doğrula. Geçerli çağrıyı elle secret taşıyan bir `curl` ile değil, staging DB'de `private.invoke_push_worker('push-dispatch', '{"drain":true,"batchSize":1}'::jsonb)` üzerinden üret; `pg_net` sonucu 2xx olmalı ve aynı yakalanmış request'in replay'i reddedilmelidir.
5. Outbox, delivery ve receipt durumlarını; retry gecikmesini; geçersiz token temizliğini gözle.
6. Production rotasyonunda önce Edge Function secret'ını, hemen ardından Vault kaydını değiştir. Kısa geçiş boyunca cron'u durdur; doğrulamadan sonra yeniden etkinleştir.

## Terminal teslimat inceleme ve kontrollü replay

`query_terminal_notification_delivery(event_id)` mesaj gövdesi/token döndürmeden teknik durumu verir. `replay_terminal_notification_delivery(event_id, client_request_id, replay_reason)` yalnız `service_role` içindir; yalnız terminal event'i, 10-500 karakter ticket/gerekçe ve sabit UUID idempotency anahtarıyla yeniden kuyruğa alır. Her çağrı immutable private audit kaydı oluşturur. Anon/auth çağrısı, non-terminal event, aynı UUID'nin başka event'te kullanımı veya doğrudan tablo değişikliği reddedilir. Production replay iki kişilik onay, incident/ticket kimliği ve önce/sonra sorgu kanıtı olmadan çalıştırılmaz; pasifleştirilmiş bir token ayrıca istemci tarafından yeniden kaydedilmedikçe replay teslimat üretmez.

## Alarm ve müdahale

- `pending` yaşının 10 dakikayı aşması, sürekli `retryable`, `MAX_ATTEMPTS_EXHAUSTED` veya worker 401 sonuçları olay olarak ele alınır.
- Önce Vault/Function secret eşitliği, cron çalışmaları, `pg_net` yanıtları ve Expo hata kodları kontrol edilir.
- Geri alma gerektiğinde cron işleri durdurulur. Outbox kayıtları silinmez; önceki çalışan Edge Function sürümü ve secret çifti geri yüklenir, ardından pending kayıtlar tekrar drain edilir.
- Gerçek cihaz teslimi; uygulama ön planda, arka planda, kapalı, token yenilenmiş ve token geçersizleşmiş durumlarda hem iOS hem Android için kanıtlanmadan push kapısı tamamlanmış sayılmaz.

Bu depoda dispatcher/receipt kodu ve zamanlama sözleşmesi hazırdır. Staging deploy, gerçek Expo/APNs/FCM receipt'i ve fiziksel cihaz teslim kanıtı henüz üretilmemiştir.

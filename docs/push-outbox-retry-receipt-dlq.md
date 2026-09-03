# Push outbox, retry, receipt ve DLQ

## Tek sahiplik ve durum zinciri

PostgreSQL tek durable source of truth'tür; Cloudflare Queue veya ikinci bir push kuyruğu yoktur.

```text
domain trigger
  -> notification_events (dedupe_key unique)
  -> best-effort after-insert push-dispatch çağrısı
  -> etkinlink-push-outbox-drain (her dakika, durable fallback)
  -> event claim / Expo ticket / notification_deliveries
  -> etkinlink-push-receipts (her 5 dakika)
  -> receipt lease + CAS
  -> delivered | invalid_token | retryable | permanent_failure
```

- Drain varsayılan 20, en çok 25 event claim eder; `SKIP LOCKED` ve 10 dakikalık stale-processing recovery kullanır. Function en çok dört event'i paralel işler ve Expo'ya en çok 100 mesajlık chunk gönderir.
- Event attempt limiti beştir. Geçici provider sonucu DB backoff'a gider; limit sonunda `cancelled/MAX_ATTEMPTS_EXHAUSTED` logical DLQ oluşur. `(notification_event_id, push_token_id)` unique olduğundan başarılı cihaz tekrar gönderilmez.
- Ticket alan delivery ilk receipt kontrolüne 15 dakika sonra uygundur. Receipt worker en çok 300 satır claim eder.
- Her claim yeni UUID `receipt_lease_id` ve iki dakikalık lease üretir. `persist_push_receipt_result` aynı delivery ID + attempt + lease eşleşmesini ister; stale worker `false` alır.
- Expo ağ/408/429/5xx hatası ile malformed/oversized başarılı provider cevabı durable receipt attempt tüketir. DB backoff sırası 5, 10, 20 ve 40 dakika + 0–60 saniye bounded jitter'dır. Beşinci `retryable`, DB'de atomik `permanent_failure/MAX_RECEIPT_ATTEMPTS_EXHAUSTED` olur. Legacy null schedule satırları migration'da 15 dakikaya backfill edilir; NOT VALID→VALIDATE CHECK bundan sonra eligible satırın schedule taşımasını zorunlu kılar ve claim sırası aynı partial scheduling index'iyle desteklenir.
- `DeviceNotRegistered`, receipt'i `invalid_token` yapar ve tokenı aynı transaction'da pasifleştirir.
- `query_terminal_notification_delivery` yalnız teknik durum döndürür. `replay_terminal_notification_delivery` service-role-only, UUID idempotency anahtarlı, 10–500 karakter gerekçeli ve immutable auditlidir. Replay disabled tokenı canlandırmaz.

## Doğrulama ve güvenli sorgular

Repo/CI:

```powershell
npx --yes deno@2.9.6 fmt --check supabase/functions
npx --yes deno@2.9.6 lint supabase/functions
npx --yes deno@2.9.6 check --frozen --node-modules-dir=auto supabase/functions/*/index.ts
npx --yes deno@2.9.6 test --frozen --node-modules-dir=auto supabase/functions/**/*.test.ts
```

İzole DB:

```bash
supabase db start
supabase db lint --local --schema public --level warning --fail-on warning
supabase test db --local
supabase stop --no-backup
```

Production/staging gözlemi yalnız protected SQL oturumunda ve içerik seçmeden yapılır:

```sql
select delivery_status, last_error_code, count(*)
from public.notification_events
group by delivery_status, last_error_code
order by delivery_status, last_error_code;

select receipt_status, receipt_error_code, count(*)
from public.notification_deliveries
group by receipt_status, receipt_error_code
order by receipt_status, receipt_error_code;

select jobname, schedule, active
from cron.job
where jobname in ('etkinlink-push-outbox-drain', 'etkinlink-push-receipts')
order by jobname;
```

Bir terminal olay için önce service-role RPC ile PII-safe durum al; replay yalnız incident ID, iki kişi onayı ve yeni UUID ile yapılır:

```sql
select public.query_terminal_notification_delivery('<EVENT_UUID>'::uuid);

select public.replay_terminal_notification_delivery(
  '<EVENT_UUID>'::uuid,
  '<NEW_REQUEST_UUID>'::uuid,
  'INC-0000 approved controlled replay'
);
```

Raw tablo dump'ı alma; token, title, body, payload ve error message artifact'e koyma. Kanıt yolu `artifacts/push/<sha>/outbox-receipt/`; DB lint, pgTAP, Function testleri, redacted aggregate before/after, scheduler tekilliği, stale-lease sonucu ve replay audit ID hash'i burada bulunur.

## Müdahale ve rollback

Backlog büyürse önce scheduler tekilliği/aktifliği, dispatch trigger, Vault–Function secret eşleşmesi, `pg_net` sonucu ve Expo hata sınıfını kontrol et. Satır silme, attempt sıfırlama, lease'i elle değiştirme veya disabled tokenı açma.

Function regresyonunda iki scheduler ve dispatch trigger'ını kontrollü durdur, aynı DB RPC sözleşmesiyle uyumlu son bilinen iyi iki Function'ı deploy et, sentetik ticket+receipt doğrula, sonra çağrıları tek tek aç. Forward-only receipt migration'ını production'da geri alma; eski lease'siz Function sürümüne dönme. Gerekirse outbox kapalıyken birikir ve düzeltmeden sonra normal concurrency ile drain edilir.

## Release kararı

DB lint/pgTAP, Function fault-injection, staging transient outage, stale lease, beşinci-attempt DLQ, auditli replay ve backlog alarmının gerçekten ateşlendiği aynı SHA kanıtı yoksa **NO-GO**. Repo testinin varlığı runtime başarısı sayılmaz.

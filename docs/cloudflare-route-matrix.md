# Cloudflare route matrisi

Default deny uygulanır. Aşağıdaki listede olmayan path `404`, listede olmayan method
`405` döner. Native mobil isteklerinde `Origin` header'ının olmaması geçerlidir;
header varsa exact environment allowlist eşleşmesi zorunludur.

| Edge route                | Method     | Auth                                              | Origin          | Request → mevcut Function body                         | Response                      | Cache               | Retry                                           |
| ------------------------- | ---------- | ------------------------------------------------- | --------------- | ------------------------------------------------------ | ----------------------------- | ------------------- | ----------------------------------------------- |
| `/v1/events`              | `POST`     | Supabase JWT                                      | `etkinlik-api`  | mevcut `{action:list\|detail\|catalog,...}` aynen      | mevcut DTO                    | `private, no-store` | Yok; POST otomatik retry edilmez                |
| `/v1/events`              | `GET/HEAD` | Supabase JWT                                      | `etkinlik-api`  | allowlist query → `{action:list,...}`                  | `{events,total,nextSkip}`     | `private, no-store` | 429/500/502/503/504, en çok 3 deneme            |
| `/v1/events/:externalId`  | `GET/HEAD` | Supabase JWT                                      | `etkinlik-api`  | `{action:"detail",eventId}`                            | `{event}`                     | `private, no-store` | Aynı bounded GET politikası                     |
| `/v1/catalog`             | `GET/HEAD` | Supabase JWT                                      | `etkinlik-api`  | `{action:"catalog"}`                                   | `{cities,formats,categories}` | `private, no-store` | Aynı bounded GET politikası                     |
| `/internal/ingest-events` | `POST`     | HMAC timestamp + nonce; kullanıcı JWT'si geçersiz | `ingest-events` | exact `{}` body; origin cron secret yalnız binding'den | mevcut ingest sonucu          | `private, no-store` | Yok; ingest idempotency origin transaction'ında |

## Liste query allowlist'i

Yalnız `city`, `formats` (virgülle ayrılmış), `startAt`, `endAt`, `sort`, `skip`,
`take` kabul edilir. Bilinmeyen/tekrarlı query, `take > 50`, negatif offset ve geçersiz
event ID `400` olur. Search text mevcut mobil davranışta local DTO üzerinde uygulanır;
Worker yeni arama semantiği üretmez.

## Kapsam dışı route'lar

`/auth`, `/rest`, `/realtime`, `/storage`, `/profile`, `/rooms`, `/messages`,
`/matching`, `/reports`, `/delete-account`, join/save ve private media route'u yoktur.
Bu path'lerin edge'e eklenmesi feature-freeze ve threat-model review gerektirir.

## Response sözleşmesi

Her response `X-Request-ID`, `Cache-Control: private, no-store, max-age=0`,
`X-Content-Type-Options: nosniff` ve `Referrer-Policy: no-referrer` taşır. Hatalar
sanitized `{ "error": "..." }` JSON'dur. Origin teknik hata gövdesi ve stack trace
istemciye aktarılmaz. Origin `Retry-After` yalnız 429 yanıtında bounded şekilde
uygulanır/istemciye taşınır.

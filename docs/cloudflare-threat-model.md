# Cloudflare edge threat model

## Varlıklar ve trust boundary

Korunan varlıklar Supabase access JWT, event origin erişilebilirliği, ingest cron
secret'i, HMAC secret'i, katalog bütünlüğü ve kullanıcı gizliliğidir. Worker public
Internet ile sabit Supabase Function origin'i arasında trust boundary'dir. Worker DB
credential, service-role key, provider token, message, location veya private media
işlemez.

## Tehditler ve kontroller

| Tehdit                               | Kontrol                                                                       | Otomatik kanıt      | Kalan risk/operasyon                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| Sahte/expired/wrong-tenant JWT       | ES256/RS256 signature, exact issuer/audience, `exp`/`nbf`, role ve UUID sub   | `security.test.ts`  | Supabase JWKS key rotation preview smoke ile izlenmeli               |
| Algoritma downgrade/HS secret talebi | Sabit alg allowlist; service-role/JWT secret yok                              | Type/unit test      | Legacy HS256-only proje edge cutover'a uygun değildir                |
| Route/method escalation              | Exact route/method matcher, default 404/405                                   | `worker.test.ts`    | WAF defense-in-depth manuel                                          |
| Oversized/malformed input            | Content-Length + streaming byte cap, JSON/content-type ve strict Zod          | `worker.test.ts`    | WAF body limit manuel                                                |
| SSRF/open proxy/redirect             | Config-only HTTPS origin/function name, aynı origin kontrolü, 3xx fail-closed | type/test + dry-run | DNS/provider account compromise kapsam dışı incident                 |
| Origin response poisoning            | JSON/content-length/stream cap ve strict public DTO schema                    | `origin.test.ts`    | Provider semantic correctness Supabase normalization sorumluluğu     |
| User-A/User-B cache leakage          | Shared cache kapalı, her response no-store                                    | iki kullanıcı testi | Gelecek cache değişikliği ayrı review gerektirir                     |
| Token/PII log sızıntısı              | Structured allowlist log; header/body/query/sub loglanmaz                     | source review       | Cloudflare log access/retention provider'da sınırlanmalı             |
| Abuse/origin exhaustion              | Verified-sub route rate limit, bounded timeout, GET-only bounded retry        | Worker/origin tests | Rate binding eventually consistent; WAF/alarm gerekli                |
| Mutation duplicate/retry             | POST adapter ve ingest otomatik retry edilmez                                 | origin retry testi  | Ingest DB idempotency Supabase transaction testine bağlı             |
| Internal trigger forgery             | HMAC timestamp + nonce + exact body; ayrı secret                              | HMAC tests          | Secret rotation ve scheduler identity manuel                         |
| Internal trigger replay              | 60 sn window + nonce Rate Limit binding                                       | replay test         | Cross-colo strict ledger değildir; scheduler WAF restriction gerekir |
| CORS browser abuse                   | Exact per-env allowlist; native missing-Origin kabul                          | Worker tests        | CORS authentication değildir; JWT/HMAC temel kontroldür              |
| Secret/config hatası                 | Secret min length, HTTPS and identity-origin config checks, generated Env     | type/config test    | Provider secret presence smoke gerekli                               |

## Hata ve fail-closed davranışı

- JWKS, JWT veya config doğrulanamazsa origin çağrılmaz.
- Rate-limit binding reject ederse `429`; internal replay `409`.
- Timeout `504`; redirect, content-type, body veya DTO schema hatası `502`.
- Teknik origin body/stack istemciye aktarılmaz.
- Retry yalnız semantik `GET/HEAD` adapter'da 429 ve seçili 5xx için toplam üç
  denemeyle sınırlıdır. `Retry-After` en fazla 1 saniye bekletir. POST/ingest retry yok.

## Incident/rollback tetikleri

JWT failure, origin 5xx, latency, schema rejection, 429 veya request budget oranında
ölçülmüş baseline dışı artışta rollout durdurulur. Cache leakage, auth bypass, secret
sızıntısı veya HMAC replay gözlenirse production Worker eski version'a derhal rollback
edilir; ilgili secret rotate edilir ve stable mobile doğrudan-origin fallback'i
etkinleştirilir. Provider dashboard ve runtime alarm kanıtı aynı commit SHA'ya
bağlanmadan release GO verilmez.

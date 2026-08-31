# EtkinLink seçici Cloudflare mimarisi

## Karar

Cloudflare, Supabase'in yerine geçmez. Worker yalnız mevcut etkinlik kataloğu HTTP
sözleşmesinin sabit host, giriş doğrulama, şema doğrulama, hız sınırı ve origin
dayanıklılığı katmanıdır. Aşağıdaki akışlar doğrudan Supabase'te kalır:

- Auth ve session refresh;
- PostgreSQL, RPC ve RLS;
- Realtime rooms/messages/matching;
- private Storage ve signed profile media;
- join/save/report/block/account deletion ve diğer mutation'lar.

Yeni Queue, KV, D1, R2, Durable Object, Pages veya kullanıcı yüzeyi eklenmemiştir.
Event DTO'sunun source of truth'u ve provider normalizasyonu `etkinlik-api` Supabase
Function'dır.

```text
EtkinLink mobile
  ├─ direct Supabase: auth, data, realtime, private storage, mutations
  └─ EDGE_API_BASE_URL
       └─ Cloudflare Worker
            ├─ verify Supabase JWT via pinned issuer/audience/JWKS
            ├─ strict route/method/query/body/response schemas
            ├─ Cloudflare Rate Limit bindings
            └─ Supabase Function origin
                 ├─ etkinlik-api
                 └─ ingest-events (internal HMAC route only)
```

## Mobil sözleşme ve rollback

Yeni binary'de `EDGE_API_BASE_URL` tanımlıysa mobil transport mevcut gövdeyi
`POST ${EDGE_API_BASE_URL}/v1/events` adresine yollar. Header'lar:

```http
Authorization: Bearer <SUPABASE_ACCESS_JWT>
Content-Type: application/json
X-Request-ID: <UUID, optional>
```

Gövde ve cevap değişmez:

- `{ "action": "list", ... }` → `{ events, total, nextSkip }`;
- `{ "action": "detail", "eventId": 42 }` → `{ event }`;
- `{ "action": "catalog" }` → `{ cities, formats, categories }`.

Worker kapatılırsa veya kill switch uygulanırsa mobil transport'un repository'deki
mevcut doğrudan `supabase.functions.invoke("etkinlik-api")` yolu rollback'tir.
Origin Function sözleşmesi cutover boyunca geriye uyumlu tutulmalıdır.

## Güvenlik sınırları

- JWT yalnız `ES256` veya `RS256`, repository'deki Supabase issuer, audience
  `authenticated` ve HTTPS JWKS ile doğrulanır. `exp`, `nbf`, issuer, audience,
  signature, UUID `sub` ve `role=authenticated` zorunludur. Legacy HS256 Worker'da
  kabul edilmez.
- Client Authorization header'ı yalnız `etkinlik-api` origin'ine aktarılır. Cookie,
  Supabase service-role key veya provider token Worker'da bulunmaz.
- İç ingest tetikleyici kullanıcı JWT'sini kabul etmez. İstek exact body hash,
  timestamp ve UUID nonce üzerinde HMAC-SHA256 ile imzalanır. Origin'e ayrı
  `ORIGIN_INGEST_SECRET` gönderilir.
- URL, Function adı ve route kullanıcı girdisinden türetilmez. HTTPS origin sabit
  config'tir; redirect'ler `manual` yakalanıp reddedilir.
- Response body Content-Type ve 1.5 MiB üst sınırı doğrulanarak stream üzerinden tek
  kez okunur. Kişiselleştirilmiş event (`joined=true`, `saved=true`, attendee photo)
  şema kapısından geçmez.
- Loglar request ID, environment, route, method, status, duration ve `cf-ray` ile
  sınırlıdır. Token, query, body, `sub`, nonce, secret, signed URL ve PII loglanmaz.

Internal imza canonical biçimi şöyledir; timestamp Unix saniyesi, body gönderilecek
exact UTF-8 metindir:

```text
body_hash = lowercase_hex(SHA256(body))
canonical = timestamp + "\n" + nonce + "\n" + body_hash
X-EtkinLink-Signature = "v1=" + lowercase_hex(HMAC_SHA256(secret, canonical))
```

İstek ayrıca `X-EtkinLink-Timestamp` ve `X-EtkinLink-Nonce` header'larını taşır.

## Environment ve binding ayrımı

Kaynak: `infra/cloudflare/etkinlink-edge/wrangler.jsonc`.

| Environment | Worker                       | Route                         | Rate-limit namespace |
| ----------- | ---------------------------- | ----------------------------- | -------------------- |
| development | `etkinlink-edge-development` | `api-dev.etkinlink.app/*`     | `310101/310102`      |
| preview     | `etkinlink-edge-preview`     | `api-preview.etkinlink.app/*` | `310201/310202`      |
| production  | `etkinlink-edge-production`  | `api.etkinlink.app/*`         | `310301/310302`      |

Bindings ve vars environment'lar arasında miras alınmış varsayılmaz; her birinde
açıkça tanımlıdır. Compatibility date `2026-08-30`, `nodejs_compat` ve structured
Workers Observability açıktır. `Env` elle yazılmamış, `wrangler types` çıktısıdır.

Repository'deki `*.invalid` Supabase origin/JWT/JWKS değerleri yalnız fail-closed
dry-run placeholder'larıdır. Preview ve production workflow'ları protected GitHub
Environment'tan ayrı `ORIGIN_BASE_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWKS_URL`,
`ALLOWED_ORIGINS`, `PREVIEW_SUPABASE_PROJECT_REF` ve
`PRODUCTION_SUPABASE_PROJECT_REF` değerleri gelmeden deploy etmez. İki 20 karakterli
project ref farklı olmalıdır; workflow üç identity URL'sinin exact path'lerle o
environment için ilan edilen `<project-ref>.supabase.co` host'una ait olduğunu ve
diğer environment host'u olmadığını doğrular.

## Secret'lar

Repository'ye değer yazılmaz. Her environment için ayrı girilir:

```powershell
npx wrangler secret put INTERNAL_TRIGGER_HMAC_SECRET --env development
npx wrangler secret put ORIGIN_INGEST_SECRET --env development
npx wrangler secret put INTERNAL_TRIGGER_HMAC_SECRET --env preview
npx wrangler secret put ORIGIN_INGEST_SECRET --env preview
npx wrangler secret put INTERNAL_TRIGGER_HMAC_SECRET --env production
npx wrangler secret put ORIGIN_INGEST_SECRET --env production
```

İki secret farklı, en az 32 rastgele byte ve Supabase `INGEST_CRON_SECRET` ile
koordine edilmiş olmalıdır. Production değeri preview/development ile paylaşılmaz.

## Dağıtım ve geri alma

Önce local kalite ve provider'a yazmayan dry-run çalıştırılır:

```powershell
cd infra/cloudflare/etkinlink-edge
npm ci
npm run check
npm run dry-run
```

Preview smoke testinden sonra production traffic değişimi protected
environment/manual approval altında eski ve yeni version ID ile
`5% → 25% → 50% → 100%` yapılmalıdır. Ancak mevcut repository gerçek production
baseline version ID'sini güvenilir biçimde seçemiyor ve rollout genişletirken aynı
yüklenmiş hedef version'ı idempotent biçimde tekrar kullanamıyor. Bu nedenle
`cloudflare-production.yml` mutation adımından önce kasıtlı olarak hata verir; hiçbir
upload/deploy çalıştırmaz ve release **NO-GO** kalır.

Blok kaldırılmadan önce workflow, onaylanan mevcut baseline version ID'sini açıkça
almalı/doğrulamalı, hedef SHA için version'ı yalnız bir kez yükleyip kalıcı ID'sini
kanıta yazmalı ve sonraki yüzdelerde aynı iki version ID'yi yeniden kullanmalıdır.
Hedef operasyon sözleşmesi şöyledir:

```powershell
npx wrangler versions upload --env production --tag <COMMIT_SHA>
npx wrangler versions deploy <NEW_ID>@5% <OLD_ID>@95% --env production -y
```

Her aşamada origin 5xx/429, Worker error ratio, p95 latency, auth failure ve response
schema error baseline'a karşı değerlendirilir. Repository'de gerçek baseline/runtime
kanıtı olmadığından eşik uydurulmaz; artışta rollout durdurulur. Geri alma:

```powershell
npx wrangler rollback <OLD_VERSION_ID> --env production --message "rollback <COMMIT_SHA>"
```

Cloudflare account/zone, route ownership, API token, secret, WAF, güvenli baseline
version seçimi ve runtime smoke/rollback kanıtları eklenmeden deployment tamamlanmış
sayılmaz.

## Resmî referanslar

- <https://developers.cloudflare.com/workers/best-practices/workers-best-practices/>
- <https://developers.cloudflare.com/workers/wrangler/configuration/>
- <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- <https://developers.cloudflare.com/workers/versions-and-deployments/>

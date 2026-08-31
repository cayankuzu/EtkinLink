# Cloudflare cache ve rate-limit politikası

## Cache kararı

Mevcut event DTO'ları kullanıcıdan bağımsız görünse de mevcut `etkinlik-api`
Function geçerli Supabase JWT ister. Master sözleşme authenticated/cookie taşıyan
response'un shared cache'e girmesini yasakladığı için ilk cutover'da **hiçbir Worker
route'u shared cacheable değildir**.

- Bütün response'lar `private, no-store, max-age=0`;
- `caches.default`, Cache API ve cache override kullanılmaz;
- Authorization cache key'den çıkarılarak paylaşım yapılmaz;
- `joined`, `saved`, `attendeePhotoUrls` veya `attendeeCount != 0` içeren origin event
  response'u zaten strict schema ile `502` olur;
- testler user-A ve user-B çağrılarının origin'e ayrı gittiğini doğrular.

Cache ancak Supabase'te ayrı, anonymous, yalnız public DTO döndüren ve block/privacy
etkisinden bağımsız olduğu RLS/contract testleriyle kanıtlanmış bir origin sözleşmesi
oluşursa ayrıca açılabilir. O değişiklikte route matrix `PUBLIC_CACHEABLE` olarak
değişmeli; normalize query allowlist, versioned key, kısa ölçülmüş TTL, ingest sonrası
targeted purge ve A/B leakage testleri zorunludur. Bu iş mevcut implementasyonda
tamamlanmış gibi gösterilmez.

## Worker Rate Limit bindings

In-memory `Map` yoktur. Her environment bağımsız namespace kullanır.

| Binding               | Actor key                          | Development |   Preview | Production | Amaç                                                                                   |
| --------------------- | ---------------------------------- | ----------: | --------: | ---------: | -------------------------------------------------------------------------------------- |
| `API_RATE_LIMITER`    | SHA-256(`verified sub + route`)    |   240/60 sn | 120/60 sn |  120/60 sn | Bir mobil NAT IP'sindeki farklı kullanıcıları birlikte cezalandırmadan origin koruması |
| `INGEST_RATE_LIMITER` | SHA-256(`ingest + verified nonce`) |     1/60 sn |   1/60 sn |    1/60 sn | Aynı signed trigger'ın kısa pencere replay azaltımı                                    |

Bu rakamlar güvenlik üst sınırıdır, business quota değildir. Event join/message/report
gibi business invariant ve quota'lar PostgreSQL transaction/RPC'de kalır.

Cloudflare Rate Limiting binding colo-local, permissive ve eventually consistent'tir;
tam muhasebe veya global nonce ledger değildir. İç trigger'da ek korumalar:

- 60 saniyelik timestamp penceresi;
- UUID nonce;
- exact body SHA-256 üstünde HMAC-SHA256;
- constant-time signature karşılaştırması;
- ayrı origin secret;
- production WAF'ta scheduler source restriction.

Birden çok coğrafyadan yetkili scheduler kullanılacak veya strict global one-time nonce
gerekirse atomic Durable Object ayrı architecture/security kararıyla eklenmelidir;
mevcut gereksinim olmadan ikinci state store eklenmemiştir.

## WAF/provider manual kapıları

Provider dashboard kanıtı olmadan aşağıdakiler uygulanmış sayılmaz:

1. Sadece route matrix method/path'lerine izin veren WAF custom rule;
2. `/internal/ingest-events` için scheduler IP/Access service identity kısıtı;
3. 16 KiB public, 2 KiB internal body üst sınırını edge öncesinde reddetme;
4. bot/ASN sinyallerini önce log-only izleyip false-positive review sonrası block;
5. Worker 429, origin 429/5xx, CPU ve request budget alarmı.

Kod katmanı WAF olmasa da fail-closed method/path/body/schema kontrollerini uygular;
WAF defense-in-depth'tir.

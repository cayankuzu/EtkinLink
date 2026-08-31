# Hesap silme devam worker'ı

Hesap silme isteği Auth kullanıcısı silindikten sonra istemci oturumuna bağlı değildir. `auth_deleted` ve `storage_deleting` aşamaları `private.account_deletion_requests` içinde kalıcıdır; dakikalık veritabanı işi bunları sınırlı claim'lerle `delete-account` Edge Function'ına devam ettirir. Bu yol yeni bir kullanıcı özelliği değildir ve mobil istemci tarafından çağrılmaz.

## Ortam kurulumu

Her staging/production ortamında birbirinden farklı, en az 32 karakterlik rastgele bir değer üret. Değer kaynak koda, mobil ortama, komut çıktısına veya kanıt paketine yazılmaz.

- Vault `edge_functions_base_url`: ortamın `https://<project-ref>.supabase.co/functions/v1` tabanı.
- Vault `account_deletion_worker_secret`: yalnız bu worker için kullanılan secret.
- Edge Function `ACCOUNT_DELETION_WORKER_SECRET`: Vault'taki değerle birebir aynı secret.

`ACCOUNT_DELETION_WORKER_SECRET`, `push_worker_secret` ile paylaşılmaz. Önce Edge secret'ını tanımlayıp `delete-account` Function'ını deploy et, sonra migration'ı uygula. Migration tam olarak bir `etkinlink-account-deletion-continuations` pg_cron işi kurar; Vault eksik/geçersizken iş uyarı verip dış çağrı yapmadan kapanır.

`delete-account` için `verify_jwt=false` bilinçlidir: aynı endpoint kullanıcı çağrısında recent-login JWT'sini PostgREST üzerinden doğrular, worker çağrısında ise aşağıdaki HMAC protokolünü doğrular. Bu ayar endpoint'i anonim kullanıma açmaz.

## Güvenlik ve çalışma sınırları

Zamanlayıcı exact JSON gövdesini `delete-account-continuation` scope'u, Unix timestamp ve UUID nonce ile HMAC-SHA256 imzalar. Ortak iç worker başlık adları `x-push-worker-timestamp`, `x-push-worker-nonce` ve `x-push-worker-signature` olarak kalır; “push” adı yetki kapsamı değildir. Edge Function ±5 dakika zaman penceresini, exact gövde imzasını ve nonce'ın service-role-only RPC ile ilk kez tüketildiğini doğrular.

- Cron her dakika çalışır; normal batch `5`, sunucu üst sınırı `10` claim'dir.
- Claim lease'i 3 dakikadır ve `FOR UPDATE SKIP LOCKED` ile tek sahibine verilir.
- Bir claim en çok 500 Storage nesnesi siler; devam varsa 15 saniye sonrasına yeniden planlanır.
- Başarılı bir Storage parçası hata bütçesini sıfırlar. Bu yüzden hesap boyutu 8 parça ile sınırlanmaz.
- Ardışık hata backoff'u 30 saniyeden başlayıp en çok 1 saate çıkar.
- Sekizinci ardışık hata veya son claim lease'inin süresinin dolması terminal durum üretir; sonsuz otomatik retry yapılmaz.
- Storage listesi yalnız UUID'nin case-insensitive ilk path segmenti olduğu nesneleri kabul eder. Başka sahip yolu görülürse silme fail-closed durur.

## İzleme

Service-role bağlantısıyla terminal kayıtları sınırlı RPC'den okunur. Sonuçtaki UUID'ler kişisel/operasyonel veridir; loglara veya ticket başlığına kopyalanmaz.

```sql
select *
from public.list_terminal_account_deletion_continuations(100);
```

Veritabanı operatörü ayrıca cron ve HTTP teslimini PII taşımayan metadata ile kontrol eder:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'etkinlink-account-deletion-continuations';

select status, count(*)
from net._http_response
where created < clock_timestamp()
  and created >= clock_timestamp() - interval '1 hour'
group by status
order by status;
```

`pg_net` şeması ortam sürümünde farklıysa Dashboard cron/Edge logları kullanılır. Request gövdesi, imza, secret, kullanıcı UUID'si veya Storage yolu gözlem aracına eklenmez.

## Terminal olay müdahalesi

1. Otomatik işi kapatmadan önce Function deploy durumu, Vault/Edge secret eşitliği, saat sapması, service-role RPC erişimi ve Storage hata sınıfını kontrol et.
2. `continuation_last_error_code`, attempt ve terminal zamanını yalnız erişimi kısıtlı olay kaydına al; kullanıcı verisini yayma.
3. Hatalı Function sürümü veya secret varsa düzeltip staging'de geçerli HMAC, replay reddi ve gerçek özel Storage temizliğini doğrula.
4. Terminal kaydı kendiliğinden yeniden claim edilmez. İnceleme sonrasında yeniden kuyruğa alma gerekiyorsa doğrudan Storage nesnesi veya Auth kaydı silme; iki kişilik onayla, hedef `(user_id, client_request_id, continuation_terminal_at)` değerini compare-and-set eden forward düzeltme migration'ı kullan.
5. Düzeltmeden sonra terminal listenin boşaldığını, fazın `completed` olduğunu ve aynı istek tekrar işlendiğinde idempotent kaldığını kanıtla.

Secret rotasyonunda cron'u kısa süre kapat; önce Edge secret'ını, hemen ardından Vault değerini değiştir. Geçerli imzalı staging çağrısı ve replay reddi görülmeden cron'u yeniden açma. Geri almada saga kayıtları veya Storage nesneleri silinmez; çalışan Function/secret çifti geri yüklenir ve kalıcı claim'ler yeniden drain edilir.

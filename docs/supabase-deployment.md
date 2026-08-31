# Supabase dağıtımı

Bu belge secret değerlerini içermez. Secret'ları sohbete veya kaynak koda yapıştırma.

## Migration

2026-08-30 itibarıyla repoda 53 forward migration bulunur. Aynı gün temiz yerel reset tümünü uyguladı; `public` lint 0 bulgu ve dört dosyada 174/174 pgTAP verdi. Bu sonuç linked staging/production deploy kanıtı değildir. Deploy öncesinde local/remote migration geçmişi eşitliği, linked lint ve aynı-SHA pgTAP yeniden çalıştırılmalı; geçmiş bir doğrulama güncel ortam kanıtı gibi sunulmamalıdır.

```powershell
npx supabase login
npx supabase link --project-ref <approved-environment-project-ref>
npx supabase migration list --linked
npx supabase db push --linked
npx supabase db lint --linked --level warning
```

Pooler bağlantısı zaman aşımına uğrarsa Supabase Dashboard'da projenin aktif olduğunu ve `Database > Connect` altında pooler'ın erişilebilir olduğunu doğrula; ardından farklı ağ/VPN kapalıyken tekrar dene. Database password komut satırına yazılmamalı; CLI'nin güvenli istemine girilmelidir.

`mobile-ci.yml` güvenlik işi izole GitHub runner üzerinde yerel Supabase/Docker başlatır; migration, lint ve transaction içindeki pgTAP'i production'a dokunmadan çalıştırır. Ayrı staging kanıtı bunun yerine geçmez ve release runbook'undaki environment korumasıyla ayrıca üretilir.

## Push worker Vault yapılandırması

Her ortamda Vault'a `edge_functions_base_url` ve en az 32 karakterlik `push_worker_secret` eklenir. Aynı worker secret iki Edge Function'a secret olarak verilir; `push-dispatch` ve `push-receipts` deploy edilir. URL kaynak koda veya migration'a sabitlenmez. Staging ve production aynı secret'ı paylaşmaz. Ayrıntılı rotasyon ve geri alma adımları [push operasyonları](push-operations.md) belgesindedir.

## Hesap silme devam worker'ı

Auth silindikten sonra kalan özel Storage temizliğinin kullanıcı JWT'sine bağlı kalmaması için Vault'a ayrıca `account_deletion_worker_secret`, `delete-account` Function ortamına aynı değer `ACCOUNT_DELETION_WORKER_SECRET` olarak tanımlanır. Bu secret push worker ile paylaşılmaz. Function deploy'u ve secret doğrulaması migration'dan önce tamamlanır; migration dakikalık tek continuation cron işini kurar. Kurulum, bounded retry ve terminal müdahale adımları [hesap silme operasyonları](account-deletion-operations.md) belgesindedir.

## Event.io aktarımı

`ingest-events` Edge Function yalnızca sunucuda çalışır ve `https://etkinlik.io/rss/sorgu` kaynağını kullanır.

```powershell
npx supabase secrets set INGEST_CRON_SECRET
npx supabase functions deploy ingest-events --project-ref <approved-environment-project-ref>
```

Zamanlayıcı `x-cron-secret` header'ını göndermelidir. `SUPABASE_SERVICE_ROLE_KEY` Edge Function ortamına Supabase tarafından sağlanır; mobil istemciye kopyalanmaz.

Bu çalışma aynı-SHA linked deploy veya gerçek kaynak smoke testi yapmadı. Periyodik çalışma için yalnız bir Supabase Scheduled Function ya da harici cron aynı secret header ile yapılandırılmalı; deploy/smoke çıktısı release evidence'a ortam, UTC ve commit SHA ile eklenmelidir.

## Auth

- Site URL: `etkinlink://auth/callback`
- Redirect URL'ler: `etkinlink://auth/callback`, `etkinlink://auth/reset-password`
- E-posta doğrulaması açık
- Brevo SMTP göndericisi doğrulanmış
- Üretimde DKIM/DMARC doğrulanmış kurumsal domain

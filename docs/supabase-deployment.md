# Supabase dağıtımı

Bu belge secret değerlerini içermez. Secret'ları sohbete veya kaynak koda yapıştırma.

## Migration

2026-08-19 itibarıyla repoda 46 migration bulunur. Push worker hardening, kayıt gizliliği ve mesaj rate-limit migration'ları henüz linked ortama uygulanmış sayılmaz. Deploy öncesinde yerel/remote migration geçmişi eşitliği, `db lint` ve pgTAP paketi yeniden çalıştırılmalı; geçmiş bir doğrulama sonucu güncel durum gibi sunulmamalıdır.

```powershell
npx supabase login
npx supabase link --project-ref hwolchgllljzzvwnzool
npx supabase migration list --linked
npx supabase db push --linked
npx supabase db lint --linked --level warning
```

Pooler bağlantısı zaman aşımına uğrarsa Supabase Dashboard'da projenin aktif olduğunu ve `Database > Connect` altında pooler'ın erişilebilir olduğunu doğrula; ardından farklı ağ/VPN kapalıyken tekrar dene. Database password komut satırına yazılmamalı; CLI'nin güvenli istemine girilmelidir.

CI güvenlik testi Docker kullanmaz. `staging-security` environment'ındaki `STAGING_DATABASE_URL` ve `STAGING_PROJECT_REF` ile staging şeması üzerinde `db lint` ve transaction içinde pgTAP çalıştırılır; production project ref'i güvenlik guardı tarafından reddedilir.

## Push worker Vault yapılandırması

Her ortamda Vault'a `edge_functions_base_url` ve en az 32 karakterlik `push_worker_secret` eklenir. Aynı worker secret iki Edge Function'a secret olarak verilir; `push-dispatch` ve `push-receipts` deploy edilir. URL kaynak koda veya migration'a sabitlenmez. Staging ve production aynı secret'ı paylaşmaz. Ayrıntılı rotasyon ve geri alma adımları [push operasyonları](push-operations.md) belgesindedir.

## Event.io aktarımı

`ingest-events` Edge Function yalnızca sunucuda çalışır ve `https://etkinlik.io/rss/sorgu` kaynağını kullanır.

```powershell
npx supabase secrets set INGEST_CRON_SECRET
npx supabase functions deploy ingest-events --project-ref hwolchgllljzzvwnzool
```

Zamanlayıcı `x-cron-secret` header'ını göndermelidir. `SUPABASE_SERVICE_ROLE_KEY` Edge Function ortamına Supabase tarafından sağlanır; mobil istemciye kopyalanmaz.

Fonksiyon bağlı projeye deploy edilmiştir. Gerçek kaynakla son smoke test: 50 kayıt alındı, 50 geçerli kayıt upsert edildi, detay hatası 0 ve HTTP 200. Periyodik çalışma için Supabase Scheduled Functions veya harici cron üzerinde aynı secret header yapılandırılmalıdır.

## Auth

- Site URL: `etkinlink://auth/callback`
- Redirect URL'ler: `etkinlink://auth/callback`, `etkinlink://auth/reset-password`
- E-posta doğrulaması açık
- Brevo SMTP göndericisi doğrulanmış
- Üretimde DKIM/DMARC doğrulanmış kurumsal domain

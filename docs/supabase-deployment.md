# Supabase dağıtımı

Bu belge secret değerlerini içermez. Secret'ları sohbete veya kaynak koda yapıştırma.

## Migration

2026-08-06 itibarıyla bağlı EtkinLink projesinde 13 migration uygulanmıştır; yerel/remote geçmiş eşleşir ve `db lint` hata veya uyarı döndürmez.

```powershell
npx supabase login
npx supabase link --project-ref hwolchgllljzzvwnzool
npx supabase migration list --linked
npx supabase db push --linked
npx supabase db lint --linked --level warning
```

Pooler bağlantısı zaman aşımına uğrarsa Supabase Dashboard'da projenin aktif olduğunu ve `Database > Connect` altında pooler'ın erişilebilir olduğunu doğrula; ardından farklı ağ/VPN kapalıyken tekrar dene. Database password komut satırına yazılmamalı; CLI'nin güvenli istemine girilmelidir.

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

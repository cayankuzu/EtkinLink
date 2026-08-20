begin;

-- E-posta varlığı yalnızca Supabase Auth'ın kontrollü kayıt denemesinde
-- değerlendirilir. Auth servisi aynı yanıt biçimini korur ve IP tabanlı
-- sign-up limiti uygular; Data API üzerinden hesap sorgulama yüzeyi kapatılır.
revoke all on function public.is_email_available(text) from public, anon, authenticated;
drop function if exists public.is_email_available(text);

commit;

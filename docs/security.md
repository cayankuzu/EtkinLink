# Güvenlik ve gizlilik

## Anahtar yönetimi

- Mobil pakette yalnızca Supabase URL'si ve publishable key bulunur.
- Database password, secret/service-role, SMTP ve cron secret mobil koda veya `.env.example` dosyasına girmez.
- Oturum verisi iOS Keychain/Android Keystore arkasındaki `react-native-keychain` adaptöründe saklanır.
- `.env`, `google-services.json`, keystore ve servis hesabı dosyaları git dışında tutulur.

Sohbette daha önce paylaşılmış secret'lar güvenli kabul edilmez; üretimden önce döndürülmelidir.

## Yetkilendirme

- Tüm public tablolar RLS kullanır.
- Mesaj okuma, yalnızca eşleşmenin/odanın taraflarına açıktır.
- Mesaj gönderme RPC'si aktif eşleşme, engel, silinme ve oda zaman penceresini sunucuda doğrular.
- Mesaj gönderimleri kullanıcı başına tüm DM/oda toplamında dakikada 45; aynı konuşmada 10 saniyede 8 ile sınırlandırılır. Advisory transaction lock eşzamanlı isteklerin sayım yarışını önler; aynı `client_message_id` retry'ı yeni mesaj sayılmaz.
- Profil doğum tarihi yalnızca hesap sahibine döner. Yaş ve cinsiyet görünürlüğü sunucu tarafında uygulanır.
- Profil fotoğrafları private bucket'tadır ve bir saatlik imzalı URL ile sunulur.
- Private Realtime topic'leri eşleşme üyeliği veya etkinlik katılımı ile yetkilendirilir.
- Hesap silmede kişisel veriler silinir; moderasyon kayıtları yasal/güvenlik amacıyla anonimleştirilebilir.

## Bilinçli kararlar

- SSL pinning eklenmedi. Supabase'in yönetilen sertifika rotasyonu nedeniyle plansız pinning erişim kesintisi riski doğurur. HTTPS ve platform trust store zorunludur; pinning ancak yedek pin ve rotasyon runbook'u ile eklenmelidir.
- Biyometrik uygulama kilidi MVP işlevi değildir. Token zaten Keychain/Keystore'dadır.
- Hassas mesaj içeriği telemetry/log'a yazılmaz.
- IP/device limiti veritabanında istemcinin gönderdiği bir header'a dayandırılmaz; bu kimlikler mobil istemci tarafından taklit edilebilir. IP tabanlı abuse kontrolü production API gateway/WAF katmanında, güvenilir bağlantı metadatasıyla uygulanmalıdır. DB'deki kullanıcı ve konuşma limiti yetkili son savunma katmanıdır.

## Yayın öncesi zorunlu kontroller

1. Sohbette açığa çıkan Supabase, SMTP ve veritabanı secret'larını döndür.
2. RLS testlerini bağlı staging projesinde çalıştır.
3. Supabase Realtime ayarında private channel zorunluluğunu etkinleştir.
4. Release keystore ve CI secret'larını güvenli secret store'a koy.
5. Brevo için kişisel Gmail yerine DKIM/DMARC doğrulanmış alan adı kullan.

## Geçici dependency audit istisnası

Metro'nun transitif `image-size` bağımlılığı için yayımlanmış
`GHSA-w3rx-r6r6-pgpr` ve `GHSA-5p2g-fcmc-qvqq` kayıtlarında henüz yamalı sürüm
yoktur. CI yalnızca bu iki advisory'den türeyen zinciri geçici olarak kabul eder;
yeni bir high/critical bulgu kalite kapısını durdurur. Yamalı sürüm yayımlandığında
`mobile/scripts/audit-production.cjs` allowlist'i kaldırılmalıdır.

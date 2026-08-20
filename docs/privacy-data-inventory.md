# Gizlilik veri envanteri

Bu belge App Store Privacy, Apple privacy manifest, Google Play Data Safety,
Gizlilik Politikası ve KVKK metni için tek teknik envanterdir. Mağaza formları
ve yayımlanan hukuki metinler her sürümde bu tabloyla karşılaştırılır.

| Veri                                          | Amaç                                         | Kullanıcıyla ilişkili | Saklama/işleyici                                |
| --------------------------------------------- | -------------------------------------------- | --------------------: | ----------------------------------------------- |
| Ad, kullanıcı adı, kullanıcı kimliği          | Hesap ve profil işlevleri                    |                  Evet | Supabase                                        |
| E-posta                                       | Kimlik doğrulama ve hesap güvenliği          |                  Evet | Supabase Auth, yapılandırılmış SMTP sağlayıcısı |
| Doğum tarihi ve cinsiyet tercihi              | Yaş uygunluğu, profil ve eşleşme             |                  Evet | Supabase                                        |
| Şehir, ilgi alanları ve biyografi             | Etkinlik keşfi, profil ve eşleşme            |                  Evet | Supabase                                        |
| Profil fotoğrafları                           | Profil ve sosyal işlevler                    |                  Evet | Supabase Storage                                |
| Oda ve doğrudan mesajlar                      | Mesajlaşma                                   |                  Evet | Supabase                                        |
| Expo push tokenı, platform ve uygulama sürümü | Bildirim teslimi ve geçersiz token temizliği |                  Evet | Supabase, Expo Push Service                     |
| Crash verisi                                  | Hata tespiti                                 | Hayır; PII temizlenir | Sentry, yalnız production DSN tanımlıysa        |
| Performans verisi                             | Dayanıklılık ve performans takibi            | Hayır; PII temizlenir | Sentry, yalnız production DSN tanımlıysa        |

Uygulama reklam takibi yapmaz ve `NSPrivacyTracking=false` kullanır. Sentry
`sendDefaultPii=false` ile başlatılır; e-posta, kullanıcı adı, mesaj, token,
cookie, parola ve oturum alanları gönderimden önce temizlenir.

## Üçüncü taraf işleyiciler

- **Supabase:** kimlik doğrulama, PostgreSQL, Storage, Realtime ve Edge Functions.
- **Expo Push Service:** push ticket ve receipt işlemleri. Push tokenları bildirim
  teslimi için aktarılır; `DeviceNotRegistered` tokenları devre dışı bırakılır.
- **Sentry:** yalnız production yapılandırmasında crash ve performans telemetrisi.
  Varsayılan PII gönderimi kapalıdır.

## Release kontrolü

Her mağaza gönderiminde aşağıdakiler birlikte doğrulanır:

1. `mobile/ios/EtkinLink/PrivacyInfo.xcprivacy`
2. App Store Connect Privacy cevapları
3. Google Play Data Safety cevapları
4. Yayımlanan Gizlilik Politikası ve KVKK metni
5. Bu envanter ve production'da etkin SDK/ortam değişkenleri

Mağaza konsolu ve harici hukuk sitesi repo dışı olduğu için bunlara ait güncel
ekran görüntüsü veya dışa aktarım release kanıt paketine eklenmeden gizlilik
kapısı tamamlanmış sayılmaz.

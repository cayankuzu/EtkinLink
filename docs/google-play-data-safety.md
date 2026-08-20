# Google Play Data Safety eşlemesi

Bu belge mağaza formunu doldurmak için teknik eşlemedir; son cevaplar yayınlanan gizlilik politikası ve etkin production SDK'larıyla birlikte gözden geçirilir.

| Google Play veri türü             |    Toplanır | Paylaşılır/işleyici             | Amaç                              | Silme                                     |
| --------------------------------- | ----------: | ------------------------------- | --------------------------------- | ----------------------------------------- |
| Ad, kullanıcı kimliği             |        Evet | Supabase                        | Hesap ve profil                   | Hesap silme akışı                         |
| E-posta                           |        Evet | Supabase Auth, SMTP sağlayıcısı | Hesap yönetimi, güvenlik          | Hesap silme akışı ve sağlayıcı politikası |
| Fotoğraf                          |        Evet | Supabase Storage                | Profil işlevi                     | Kullanıcı düzenleme/hesap silme           |
| Şehir ve profil bilgileri         |        Evet | Supabase                        | Keşif, profil, eşleştirme         | Kullanıcı düzenleme/hesap silme           |
| Mesajlar                          |        Evet | Supabase                        | Uygulama içi iletişim ve güvenlik | Ürün saklama/silme politikası             |
| Cihaz veya diğer kimlikler        |        Evet | Supabase, Expo Push Service     | Push teslimi ve güvenlik          | Token geçersizleşmesi/hesap silme         |
| Uygulama etkileşimi ve performans | DSN etkinse | Sentry                          | Analiz ve uygulama işlevi         | Sentry saklama politikası                 |
| Kilitlenme tanıları               | DSN etkinse | Sentry                          | Hata giderme                      | Sentry saklama politikası                 |

Veriler aktarım sırasında şifrelenir. Reklam veya üçüncü taraflar arası takip yapılmaz; hassas kullanıcı içeriği reklam amacıyla satılmaz. Mesaj, token ve kimlik verilerinin gerçekten hangi süreyle tutulduğu yayınlanan gizlilik/KVKK metninde açıkça belirtilmelidir.

Release kanıtına Google Play Console Data Safety dışa aktarımı veya tarihli ekran görüntüleri eklenmeden bu tablo mağaza beyanının tamamlandığını kanıtlamaz.

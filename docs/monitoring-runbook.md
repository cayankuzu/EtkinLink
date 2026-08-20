# Production izleme runbook'u

## Telemetri sözleşmesi

Mobil istemci Sentry'yi yalnızca DSN varsa başlatır. `sendDefaultPii=false` kullanılır; e-posta, kullanıcı adı, mesaj, parola, token, cookie ve authorization alanları olay gönderilmeden önce temizlenir. Olaylara uygulama sürümü, build, runtime, platform ve hata alanı eklenir.

Release pipeline'ı Android ve iOS build'lerinden sonra aynı release için source map bulunduğunu Sentry API üzerinden doğrular. Source map doğrulanmadan signed artifact işi başarılı sayılmaz.

## Otomatik alarmlar

`configure-monitoring.yml` manuel çalıştırıldığında altı production detector'ü ve e-posta workflow'unu idempotent biçimde oluşturur:

- genel production hata artışı;
- auth hataları;
- mesaj gönderimi ve outbox flush hataları;
- push kayıt hataları;
- ilk fatal crash;
- ilk ANR.

Aynı workflow saatte iki kez son 24 saatin production crash-free session oranını denetler. Varsayılan alt sınır `%99,5`tir ve health verisi yoksa production kontrolü başarısız olur.

## Olay müdahalesi

1. Alarmın `release`, `dist`, `environment`, `platform` ve `error_domain` etiketlerini kaydet.
2. Etkilenen release'i bir önceki sağlıklı release ile karşılaştır; source map doğrulamasını kontrol et.
3. Auth, mesaj/outbox veya push alarmında ilgili Supabase logları ve zaman penceresiyle korelasyon kur; olay içeriğine PII kopyalama.
4. Fatal/ANR artışında rollout'u durdur. Gerekirse mağaza rollout yüzdesini azalt veya son sağlıklı binary'ye dön.
5. OTA geri alması yalnız aynı `runtimeVersion` içindeki JavaScript değişiklikleri için kullanılabilir; native uyumsuzluğu OTA ile kapatılmaz.
6. Düzeltme sonrası alarmın toparlandığını ve crash-free eşiğinin yeniden geçtiğini kanıt paketine ekle.

## PII canary

Her production öncesinde yalnız test hesabıyla kontrollü bir hata üret. Sentry olayında e-posta, kullanıcı adı, mesaj metni, access/refresh token ve authorization başlığı aranır; değerlerin `[Filtrelendi]` veya kaldırılmış olduğu görülmelidir. Gerçek kullanıcı verisi canary olarak kullanılmaz.

Sentry API secret'ları ve gerçek production health verisi repo dışında olduğundan detector oluşturma, source map ve crash-free kanıtları CI çalıştırılmadan tamamlanmış kabul edilmez.

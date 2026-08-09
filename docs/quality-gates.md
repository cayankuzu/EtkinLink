# Kalite kapıları ve dürüst kapsam

## Otomatik kapılar

- TypeScript `strict`: hata yok
- ESLint: hata yok, `any` yasak, hook bağımlılıkları zorunlu
- Dependency Cruiser: döngü ve katman ihlali yok
- Knip: kullanılmayan dosya/bağımlılık/export yok
- Production dependency audit: bilinen açık yok
- Jest: 7 suite/30 test; auth, onboarding, oda sınırları, offline outbox, eşleşme kartı, hata sınırı ve uygulama smoke testleri
- Kritik saf iş kuralları coverage eşiği: statement/line/function %90, branch %85

Son doğrulama sonucu kritik çekirdekte statement/line/function %100, branch %96,55'tir. Supabase remote migration geçmişi yerelle birebir eşleşir ve remote `db lint` sonucu temizdir. `ingest-events` fonksiyonu gerçek RSS kaynağında 50/50 kayıtla HTTP 200 vermiştir.

Coverage yalnızca `authSchemas`, `onboardingSchemas`, `roomRules` ve `chatOutbox` çekirdeği için bir kalite kapısıdır. Bu sayı tüm UI'ın test kapsamı gibi sunulmaz. Ekranlar için component/smoke testleri vardır; gerçek cihaz E2E ve staging RLS testleri ayrıca gereklidir.

## Dış yapılandırma gerektiren açık kapılar

- Ayrı staging projesinde otomatik RLS saldırı/integrasyon testleri
- Firebase/APNs push kimlik bilgileri ve gerçek cihaz teslim testi
- Crash/analytics sağlayıcısı DSN/proje seçimi
- iOS build/signing testi için macOS/Xcode
- Android release signing, mağaza görselleri, gizlilik URL'si ve son uygulama ikonu
- 10.000 eşzamanlı kullanıcı iddiası için staging load test

Bu kapılar tamamlanmadan ilgili başlıklara 9.8/10 veya “production-ready” etiketi verilmez.

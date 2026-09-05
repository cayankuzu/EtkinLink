# EtkinLink — Ölçüm Planı

Bu plan **uygulamaya yeni özellik, yeni SDK veya yeni izin eklemez.** Bugün
zaten var olan telemetri yüzeyiyle ne ölçülebileceğini, neyin ölçülemediğini ve
ölçülemeyenin ne pahasına ölçülebileceğini yazar.

Kural: ölçülmemiş bir sayı `claims-register.md` bölüm 1'e giremez. Bu dosya, o
kütükteki N1–N8 satırlarının nasıl kapatılacağını tarif eder.

**Son güncelleme:** 2026-09-05

---

## 1. Bugün gerçekte ne var

Ölçülmüş envanter (`mobile/package.json`, `mobile/src/shared/lib/telemetry.ts`):

| Yüzey | Durum |
|---|---|
| Analytics SDK | **Yok.** Amplitude, Mixpanel, Segment, PostHog, Firebase Analytics yok |
| Hata/performans | `@sentry/react-native` — tek telemetri bağımlılığı |
| Hata kaydı | `captureAppError`, 20 çağrı yeri, `operation` etiketli |
| Performans kaydı | `recordPerformance`, 3 çağrı yeri (uygulama açılışı ve veri ısıtma) |
| PII filtresi | `sanitizeTelemetryValue` — e-posta, bearer, JWT ve hassas anahtar adları redakte edilir |
| Reklam kimliği | Toplanmaz |
| Cihaz konumu | İstenmez |

Etiketlenmiş `operation` değerleri bugün şunları kapsıyor: `auth.sign_in`,
`message.direct_send`, `message.room_send`, `message.*_outbox_enqueue`,
`outbox.flush`, `push.registration`, `profile.photo_cleanup_*`,
`registration.committed_draft_cleanup`.

**Sonuç:** bugün *başarısızlıkları* ve *açılış süresini* ölçebiliyoruz.
*Hunileri* ölçemiyoruz, çünkü başarı olayı yayan bir sistem yok.

---

## 2. Bugünkü yüzeyle ölçülebilecekler (yeni kod gerekmez)

| Soru | Kaynak | Nasıl |
|---|---|---|
| Uygulama çöküyor mu? | Sentry | Crash-free session / user oranı |
| Hangi işlem başarısız oluyor? | Sentry `error_domain` etiketi | `operation` bazında hata dağılımı |
| Açılış ne kadar sürüyor? | `recordPerformance` breadcrumb | Cold start ve veri ısıtma süresi |
| Mesaj gönderimi güvenilir mi? | `message.*` + `outbox.flush` hataları | Hata oranındaki değişim |
| Push kaydı tutuyor mu? | `push.registration` hataları | Başarısız kayıt oranı |
| Kaç indirme, hangi ülke? | App Store Connect / Play Console | Mağaza konsolu |
| Mağaza sayfası dönüşümü | App Store Connect / Play Console | Görüntülenme → indirme |
| D1/D7 tutundurma | Play Console / App Store Connect | Konsolun kendi tutundurma raporu |

Mağaza konsolu, uygulamaya hiçbir şey eklemeden tutundurma ve dönüşüm verir.
İlk sürüm için tek başına yeterlidir ve `claims-register.md` N1, N4, N8
satırlarını kapatır.

---

## 3. Ölçülemeyenler ve maliyeti

| Ölçüm | Neden bugün yok | Kapatmanın maliyeti |
|---|---|---|
| Onboarding tamamlanma oranı | Başarı olayı yayılmıyor | Mevcut akışa olay yayımı; yeni ekran değil |
| İlk anlamlı değer anı (ilk oda girişi) | Aynı | Aynı |
| Adım adım huni düşüşü | Aynı | Aynı |
| Kanal bazlı atıf | Attribution SDK'sı yok | Yeni vendor + gizlilik beyanı değişikliği |

**Karar:** ilk sürümde huni enstrümantasyonu **eklenmiyor.** Gerekçe: ürün
dondurmasıdır ve mağaza konsolu ilk kararlar için yeterli veriyi zaten veriyor.
Ağır bir attribution vendor'ı yalnız pazarlama için eklemek, veri beyanını
genişletir ve kütükteki C5 mahremiyet iddiasını zayıflatır.

Huni ölçümü gerekli olursa, minimum yol: `recordPerformance` ile aynı redaksiyon
zincirinden geçen, **PII taşımayan** sayaç olayları. Yeni SDK değil, yeni ekran
değil, yeni izin değil.

---

## 4. Yayın sonrası ilk ölçüm seti

Sırayla, ilk dört haftada:

1. **Kararlılık** — crash-free session ≥ %99,5. Bunun altındaysa büyüme
   çalışması durur; kırık uygulamaya trafik göndermek zarardır.
2. **Açılış** — cold start p95. Baseline burada oluşur; hedef sonra konur.
3. **Hata dağılımı** — `operation` bazında ilk üç hata kaynağı.
4. **Mağaza dönüşümü** — sayfa görüntülenme → indirme.
5. **Tutundurma** — D1 ve D7, mağaza konsolundan.

Yeterli örneklem oluşmadan hiçbir sayı `claims-register.md` bölüm 1'e taşınmaz
ve hiçbir mağaza deneyi "kazandı" ilan edilmez.

---

## 5. Gizlilik sınırları — pazarlama bunu esnetemez

Aşağıdakiler hiçbir ölçüm gerekçesiyle toplanmaz:

- mesaj içeriği;
- e-posta, ad, telefon;
- kesin konum;
- özel medya URL'si veya imzalı URL;
- access/refresh token;
- reklam kimliği.

`telemetry.ts` bunları kod düzeyinde redakte eder ve
`mobile/src/shared/lib/telemetry.test.ts` bu davranışı test eder. Ölçüm planı bu
testi gevşetmeyi gerektiriyorsa, plan yanlıştır.

Store veri beyanı (`docs/google-play-data-safety.md`) ile bu dosya birbirinden
sapamaz; sapma varsa beyan değil davranış esastır ve beyan düzeltilir.

---

## 6. Kampanya ölçümü

- Kanal başına UTM: `utm_campaign=etkinlink_<açı>_<yyyy-aa>`.
- Atıf mağaza konsolunun kendi kaynak raporuyla sınırlıdır; cihaz düzeyinde
  parmak izi çıkarılmaz.
- Bir yaratıcı ancak indirme **ve** tutundurmayı birlikte iyileştiriyorsa
  ölçeklenir. İndirmeyi artırıp D7'yi düşüren yaratıcı durdurulur.
- Ölçüm, uygulama kararlılığı veya mahremiyeti pahasına yapılmaz.

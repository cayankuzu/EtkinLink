# EtkinLink — Sunum İskeleti (TR)

Her slayt **tek mesaj** taşır. Metin en fazla gerektiği kadar, boşluk bol, görsel
gerçek ekran. Uydurma pazar büyüklüğü, gelir projeksiyonu, kullanıcı sayısı veya
testimonial yok. Ölçülmemiş her şey açıkça "henüz ölçülmedi" yazar — bu bir
zayıflık değil, dürüstlük sinyalidir ve yatırımcı tarafında böyle okunur.

**Son güncelleme:** 2026-09-04 · **Kanıt:** `claims-register.md`

---

### Slayt 1 — Problem
**Mesaj:** Gitmek istediğin etkinliğe yanında kimse yoksa gitmiyorsun.

Görsel: tek satır cümle, çok boşluk. Grafik yok.
Konuşma notu: bu bir tanışma problemi değil, *bağlam* problemi. Tanışma
uygulamaları insanı boşlukta eşleştirir; ortak zemin yoksa sohbet ölür.

---

### Slayt 2 — Kim, ne zaman
**Mesaj:** Şehirde çevresi dar 20-28 yaş; hafta içi akşam planı ararken.

Görsel: iki kısa kullanıcı durumu (persona kartı değil, cümle).
- "Şehre yeni taşındım, kimseyi tanımıyorum."
- "Konsere gitmek istiyorum ama tek başıma değil."

Not: bu segmentler ürün kopyasından ve mevcut akıştan türetildi; anket verisi
**henüz yok**.

---

### Slayt 3 — Ürünün mevcut çözümü
**Mesaj:** Önce etkinlik, sonra insan.

Görsel: üç gerçek ekran yan yana — `Discover`, `RoomDetail`, `DirectChat`.
Alt satır: `Etkinliği bul → odasına gir → karşılıklı beğenide sohbet`

---

### Slayt 4 — Gerçek kullanıcı yolculuğu
**Mesaj:** İlk anlamlı değer, ilk odaya girdiği an.

Görsel: 5 kutuluk akış, her kutu bir gerçek ekran adı:
`Kayıt → İlgi alanları → Discover → EventDetail → RoomDetail`

Konuşma notu: kayıttan ilk odaya kadar geçen adım sayısı ürünün en kritik
metriği. **Henüz ölçülmedi**; ilk yayın sonrası ölçülecek ilk şey bu.

---

### Slayt 5 — Farklılaştırıcı
**Mesaj:** Sohbetin konusu zaten var.

| | Tanışma uygulamaları | Etkinlik uygulamaları | EtkinLink |
|---|---|---|---|
| Tanışma | Var | Yok | Var |
| Ortak bağlam | Yok | — | Etkinlik |
| Grup sohbeti | Yok | Nadiren | Etkinliğin odası |

Rakip marka adı yazılmaz, kategori adı yazılır. Kanıtsız üstünlük iddiası yok.

---

### Slayt 6 — Güvenlik, mahremiyet, teknik kalite
**Mesaj:** Kalite iddiası değil, kapı sayısı.

- Satır düzeyi yetkilendirme (RLS) + pgTAP ile IDOR testleri
- Özel depolama, kısa ömürlü imzalı URL
- Engelleme / bildirme / profil gizleme / hesap silme
- 51 test paketi, 336 test; 17 otomatik kalite kapısı (`npm run verify`)
- Tekrarlanabilir (reproducible) araç imajı + provenance attestation
- Telemetride PII redaksiyonu

Görsel: `npm run verify` çıktısının gerçek ekran görüntüsü.
**Not:** Bu sayılar aynı commit SHA'sında koşan kapılardan gelir; slayt her
sürümde güncellenir, eski sayı bırakılmaz.

---

### Slayt 7 — Traction
**Mesaj:** Henüz ölçülmedi.

Bu slayt boş bırakılmaz ve doldurulmaz. Aynen şu yazılır:

> Ürün henüz yayında değil. Kullanıcı sayısı, indirme, tutundurma ve gelir
> verisi yoktur. Yayın sonrası ilk ölçüm seti: onboarding tamamlanma,
> ilk oda girişi, D1/D7, çökmesiz oturum oranı.

---

### Slayt 8 — Go-to-market
**Mesaj:** Etkinliğin kendi kitlesinin olduğu yerden başla.

- Store araması (metin: `store-listing-tr.md`)
- Yerel etkinlik toplulukları ve üniversite kulüpleri — organik, ödemesiz
- Etkinlik micro-creator'ları
- Küçük, kontrollü ücretli test (bütçe varsa)

Organizatör iş birliği **yok**; varmış gibi gösterilmez.

---

### Slayt 9 — İş modeli
**Mesaj:** Depoda tanımlı bir gelir modeli yok.

Aynen yazılır:

> Bu sürümde ödeme, abonelik, premium katman veya reklam ürünü yoktur.
> Kod tabanında karşılığı olmayan bir gelir modeli sunulmayacaktır.

---

### Slayt 10 — Sonraki adım
**Mesaj:** Sonraki adım yeni özellik değil, ölçüm.

1. Aday build ile mağaza içi test (TestFlight / Internal Track)
2. Gerçek cihazda push, erişilebilirlik ve OTA doğrulaması
3. İlk ölçüm seti (Slayt 7)
4. Ölçüm sonucuna göre karar

Yeni özellik yol haritası uydurulmaz.

---

## Tasarım kuralları

| Öğe | Kural |
|---|---|
| Slayt başına mesaj | 1 |
| Slayt başına metin | ≤ 40 kelime |
| Tipografi | Manrope (başlık), Inter (gövde) — üründeki ile aynı |
| Renk | `#5B4BFF` vurgu, `#F7F8FC` zemin, `#101828` metin |
| Boşluk | Kenarlardan ≥ %8 |
| Görsel | Yalnız gerçek ekran görüntüsü |
| Grafik | Yalnız ölçülmüş veri; ölçüm yoksa grafik yok |
| Stok fotoğraf | Kullanılmaz |

## Kaynak dosya

Düzenlenebilir kaynak `docs/marketing/assets/pitch-deck-tr.*` altında tutulur
(Figma veya Keynote/PPTX). PDF tek başına kaynak sayılmaz. Ekran görüntüleri
`screenshot-storyboard.md` ile aynı build'den alınır ve slayt notuna build SHA'sı
yazılır.

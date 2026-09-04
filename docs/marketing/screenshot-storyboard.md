# EtkinLink — Store Ekran Görüntüsü ve Önizleme Storyboard'u

**Mutlak kural:** Her kare, aday build'in gerçek ekranından alınır. Var olmayan
bir kontrol, sahte katılımcı sayısı, sahte puan, sahte mesaj veya var olmayan bir
rozet çizilmez. Fixture gerekiyorsa sentetik ve açıkça makul olur; gerçeğe aykırı
sosyal sayı üretilmez.

**Kaynak ekranlar:** `quality/feature-surface.snapshot.json`
**Son güncelleme:** 2026-09-04

---

## Teknik gereksinimler

| Hedef | Ölçü | Adet |
|---|---|---|
| App Store 6.9" (iPhone 17 Pro Max) | 1320 × 2868 | 3 zorunlu, 6'ya kadar |
| App Store 6.5" (yedek) | 1242 × 2688 | aynı kareler |
| Play telefon | 1080 × 1920 min, 9:16 | 3 zorunlu, 8'e kadar |
| Play öne çıkan grafik | 1024 × 500 | 1 |

- Başlık bandı üstte, cihaz çerçevesinin dışında; yükseklik ~%18.
- Başlık tipografisi: Manrope 700, ~64 px @1320 genişlik. Küçük listede okunmalı.
- Metin güvenli alanı: her kenardan ≥ 64 px.
- Ekran görüntüsü status bar'ı temizlenir (saat 9:41, tam pil, tam sinyal) —
  bu, içerik değil kabuk düzenlemesidir ve ürün davranışı hakkında iddia içermez.
- Renk: `colors.canvas` (#F7F8FC) zemin, `colors.brand` (#5B4BFF) vurgu. Yeni
  marka rengi üretilmez.

---

## Kareler

Sıra bilinçli: **ne var → kiminle → nasıl konuşulur**. Üç kare birbirinin
tekrarı değil, üç farklı kullanıcı işi.

### Kare 1 — Etkinliği bul
- **Ekran:** `Discover` (DiscoverTab), liste dolu durumda, en az 3 kart görünür.
- **Başlık:** `Şehrindeki etkinlikleri gör`
- **Tek kanıt:** Etkinlik kartlarında gerçek tarih, yer ve kategori.
- **Export:** `01-discover-tr.png`
- **Kanıt kaydı:** C1, C2
- **Yakalama notu:** Filtre çubuğu görünür olsun; kaydet ikonu boş durumda
  (henüz kaydedilmemiş) — kaydedilmiş görünürse "kaydettin" iması olur.

### Kare 2 — Odaya gir
- **Ekran:** `RoomDetail` veya `Rooms` listesi.
- **Başlık:** `Aynı etkinliğe gidenlerle konuş`
- **Tek kanıt:** Odanın bağlı olduğu etkinlik başlığı görünür — odanın *bağlamı*
  gösterilen şey.
- **Export:** `02-room-tr.png`
- **Kanıt kaydı:** C3
- **Yakalama notu:** Katılımcı sayısı rozeti varsa gerçek fixture değerini
  gösterir; şişirilmiş sayı yazılmaz. Mesaj balonları sentetik ve nötr olmalı,
  duygusal/flört içerikli değil.

### Kare 3 — Eşleş ve sohbet et
- **Ekran:** `MatchCards` (karar kartları) **veya** `DirectChat`.
- **Başlık:** `Karşılıklı beğenide sohbet açılır`
- **Tek kanıt:** Beğen/geç kontrolleri, ya da açılmış bir sohbet.
- **Export:** `03-match-tr.png`
- **Kanıt kaydı:** C4
- **Yakalama notu:** "Eşleştiniz!" kutlama ekranı yalnız gerçek ekran öyleyse
  kullanılır. Profil fotoğrafları sentetik/lisanslı olmalı — gerçek kişi değil.

### Kare 4 — Sınırlar sende (opsiyonel)
- **Ekran:** `ProfileVisibility` veya `Settings`.
- **Başlık:** `Görünürlüğünü sen belirlersin`
- **Kanıt kaydı:** C6, C7

### Kare 5 — Ara ve filtrele (opsiyonel)
- **Ekran:** `EventFilters` veya `EventSearch`.
- **Başlık:** `Tarihe ve kategoriye göre daralt`
- **Kanıt kaydı:** C1

### Kare 6 — Kaydettiklerin (opsiyonel)
- **Ekran:** `SavedEvents`, en az 2 kayıt.
- **Başlık:** `İlgini çekeni kaydet`
- **Kanıt kaydı:** C1

---

## Öne çıkan grafik (Play, 1024×500)

- Sol %55: `Şehrindeki etkinlikte tanış` — Manrope 700.
- Sağ %45: `Discover` ekranının hafif açılı cihaz görüntüsü.
- Zemin: `colors.brandSubtle` (#F5F2FF), `colors.brand` vurgu.
- Metin: en fazla 6 kelime. Store puanı/indirme sayısı **yok**.

---

## Uygulama önizleme videosu (opsiyonel, 15-30 sn)

Yalnız gerçek ekran kaydı. Ekran dışı animasyon eklenmez.

| Saniye | Görüntü | Üst metin |
|---|---|---|
| 0-4 | `Discover` kaydırma | Şehrinde ne var? |
| 4-9 | `EventDetail` açılışı | İlgini çekeni aç |
| 9-15 | `RoomDetail` | Gidenlerle konuş |
| 15-22 | `MatchCards` → `DirectChat` | Karşılıklı beğenide sohbet |
| 22-26 | Kapanış kartı, logo | EtkinLink |

Ses yok veya telifsiz enstrümantal. Konuşma yoksa altyazı gerekmez; varsa
Türkçe altyazı zorunlu.

---

## Üretim kontrol listesi

- [ ] Kareler aday build SHA'sından alındı; SHA bu dosyaya yazıldı.
- [ ] Her karedeki her kontrol o ekranda gerçekten var.
- [ ] Hiçbir başlık, ekranın yapamadığı bir şeyi vaat etmiyor.
- [ ] Sahte puan / kullanıcı sayısı / yorum yok.
- [ ] Fotoğraflar lisanslı veya sentetik; gerçek kişi izinsiz yok.
- [ ] İlk üç kare üç farklı işi anlatıyor, tekrar yok.
- [ ] Başlıklar `claims-register.md` terim sözlüğüyle aynı kelimeleri kullanıyor.
- [ ] Küçük önizlemede (liste görünümü) başlıklar okunuyor.

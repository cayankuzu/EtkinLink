# EtkinLink — Store Metni (TR)

Tek dil: Türkçe. Ürün adı değişmiyor.
Her cümlenin karşılığı `claims-register.md` içinde bir satırdır; kütükte olmayan
ifade buraya girmez.

**Kaynak yüzey:** `quality/feature-surface.snapshot.json`
**Son güncelleme:** 2026-09-04

---

## App Store

### İsim (30)
`EtkinLink` *(11)*

### Alt başlık (30)
`Etkinlikte tanış, odada konuş` *(29)*

> Neden: alt başlık arama sonucunda isimle birlikte okunur. İki fiil, iki mevcut
> yüzey — `Discover`/`EventDetail` ve `Rooms`. Kanıt: C1, C3.

### Tanıtım metni (170, güncellenebilir)
```
Şehrindeki etkinlikleri gör, ilgini çekenin odasına gir, aynı şeye ilgi duyan
insanlarla konuş. Karşılıklı beğeni olursa sohbet açılır.
```
*(150)* — Kanıt: C1, C3, C4.

### Açıklama — ilk üç satır kritik
```
Bir etkinliğe tek başına gitmek zorunda değilsin.

EtkinLink'te önce etkinliği bulursun, sonra o etkinliğin odasında aynı yere
gitmeyi düşünen insanları. Tanışma boşlukta değil, ortak bir bağlamda başlar.

NE YAPABİLİRSİN

• Etkinlikleri keşfet
  Şehir, tarih ve kategoriye göre filtrele. Beğendiğini kaydet.

• Etkinliğin odasına gir
  Aynı etkinlikle ilgilenen insanların olduğu odada konuş.

• Eşleş ve sohbet et
  Profilleri gör, beğen. Karşılıklı beğeni olduğunda sohbet açılır.

• Kendi sınırını kendin çiz
  Profilini gizle, rahatsız edeni engelle, içeriği bildir, hesabını sil.

MAHREMİYET

Mesajların ve profil fotoğrafların özel tutulur; kimin neyi görebileceği
sunucu tarafında satır düzeyinde kurala bağlıdır. Fotoğrafların herkese açık
bir adreste durmaz.

Uygulama tamamen Türkçedir.
```

### Anahtar kelime alanı (100, virgülle, tekrar yok)
```
etkinlik,konser,tiyatro,festival,tanışma,arkadaş,sohbet,oda,şehir,çıkış,sosyal,buluşma,katıl
```
*(97)* — İsimde/alt başlıkta geçen kelimeler burada tekrarlanmadı. Rakip marka
adı yok.

---

## Google Play

### Uygulama adı (30)
`EtkinLink` *(11)*

### Kısa açıklama (80)
```
Etkinliği bul, odasına gir, aynı şeye ilgi duyan insanlarla tanış.
```
*(66)*

### Tam açıklama (4000)
App Store açıklamasıyla aynı gövde. Play'de anahtar kelime alanı olmadığı için
"etkinlik", "oda", "eşleşme" kelimeleri metnin içinde doğal olarak geçer;
doldurma yapılmaz.

---

## Veri güvenliği / gizlilik beyanı

`docs/google-play-data-safety.md` ve `docs/privacy-data-inventory.md` ile birebir
aynı olmalıdır. Store formunda beyan edilenden **fazlası** toplanmaz, **azı**
beyan edilmez.

| Alan | Beyan | Gerçek akış |
|---|---|---|
| E-posta | Toplanır, hesap için zorunlu | Supabase Auth |
| Ad, doğum tarihi, cinsiyet, ilgi alanları | Toplanır, profil için | `profiles` |
| Fotoğraf | Toplanır, kullanıcı yükler | `profile-photos` özel bucket, imzalı kısa ömürlü URL |
| Mesaj içeriği | Toplanır, iletim için | RLS ile taraflara kapalı |
| Şehir | Toplanır, etkinlik filtresi | Kullanıcı seçer; **cihaz konumu alınmaz** |
| Çökme/tanılama | Toplanır | Sentry, PII redakte edilir (`telemetry.ts`) |
| Reklam kimliği | **Toplanmaz** | Reklam SDK'sı yok |
| Hassas konum | **Toplanmaz** | Konum izni istenmez |

Veri silme: uygulama içinden `Ayarlar → Hesabı Sil`
(`supabase/functions/delete-account`). Play'in "hesap silme" bağlantısı bu akışı
gösterir.

İçerik derecelendirmesi: kullanıcı üretimi içerik ve mesajlaşma **vardır** —
engelleme, bildirme ve kullanıcı sözleşmesi mevcuttur (Apple 1.2 / Play UGC).

---

## Yayınlanmayacak ifadeler

Kütükteki N1–N10 buraya da uygulanır. Özellikle:
- kullanıcı/indirme sayısı, yıldız görseli, kullanıcı yorumu;
- "garantili eşleşme", "kesin arkadaş";
- "AI destekli";
- "tüm etkinlikler", "Türkiye'nin en büyük…";
- "bilet al" / "rezervasyon" (ürün bilet satmaz).

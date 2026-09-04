# EtkinLink — İddia ve Kanıt Kütüğü

Bu dosya pazarlama, store ve sunum materyallerinde kullanılabilecek **tek** iddia
listesidir. Buraya kaydı olmayan bir cümle hiçbir dış yüzeyde kullanılamaz.

**Kural:** Her iddianın karşısında ya çalışan bir ekran/akış ya da ölçülmüş bir
sayı vardır. Ölçüm yoksa satır "Henüz ölçülmedi" olarak kalır ve o iddia
yayınlanmaz — silinmez, çünkü neyin eksik olduğu da bilgidir.

**Ürün yüzeyi referansı:** `quality/feature-surface.snapshot.json`
(5 sekme, 43 stack route, 39 ekran, 26 public tablo). Guard:
`node scripts/guards/check-no-new-product-surface.mjs`.

**Son doğrulama:** 2026-09-04 · **Sahip:** Çayan Kuzu

---

## 1. Kullanılabilir iddialar (kanıtlı)

| # | İddia (yayınlanabilir hâli) | Hedef kitle | Dayandığı mevcut yüzey | Kanıt | Yasak abartı |
|---|---|---|---|---|---|
| C1 | "Etkinlikleri keşfet, ilgini çekene katıl." | Şehrinde ne olduğunu takip etmek isteyen 18-30 | `Discover`, `EventDetail`, `EventSearch`, `EventFilters`, `CityPicker`, `SavedEvents` | `quality/feature-surface.snapshot.json` → `DiscoverStackParamList` | "Tüm etkinlikler", "şehrindeki her etkinlik" |
| C2 | "Etkinlik listesi gerçek bir kaynaktan gelir; elle uydurulmuş içerik yoktur." | Hepsi | `supabase/functions/ingest-events` → `etkinlik.io` | `supabase/functions/ingest-events/index.ts`, `raw_source.sync_source = "official-api-v2"` | "Türkiye'nin en büyük etkinlik veritabanı" |
| C3 | "Aynı etkinliğe ilgi duyan insanların olduğu odaya katıl." | Etkinliğe tek başına gitmek istemeyen | `Rooms`, `RoomDetail`, `RoomParticipants` | `RoomsStackParamList` (3 route) | "Binlerce aktif oda", katılımcı sayısı vaadi |
| C4 | "Karşılıklı beğeni olursa sohbet açılır." | Tanışma amaçlı kullanan | `MatchCards`, `MatchHub`, `MatchingLikes`, `DirectChat` | `20260808110000_wmatch_matching_dynamics.sql`, `20260808234500_global_likes_and_single_reactions.sql` | "Garantili eşleşme", "kesin arkadaş bulursun" |
| C5 | "Mesajların ve profil fotoğrafların yalnızca senin erişimine açık; sunucu tarafında satır düzeyinde kural uygulanır." | Mahremiyet hassasiyeti olan | Supabase RLS + `profile-photos` özel bucket | `supabase/tests/*.sql` (pgTAP RLS/IDOR), `20260807131000_profile_asset_read_policies.sql` | "Uçtan uca şifreli", "askeri seviye güvenlik" |
| C6 | "Rahatsız eden birini engelleyebilir, içeriği bildirebilirsin; engel karşılıklı görünürlüğü keser." | Hepsi | `BlockedUsers`, rapor akışı, `ChatSettings` | `20260806004500_account_and_blocking_hardening.sql`, `20260807120000_room_reports.sql` | "7/24 moderasyon ekibi" (yok) |
| C7 | "Profilini gizleyebilir, hesabını tamamen silebilirsin." | Hepsi | `ProfileVisibility`, `Settings → Hesabı Sil` | `20260805231500_account_deletion.sql`, `supabase/functions/delete-account` | — |
| C8 | "İnternet gidip geldiğinde yazdığın mesaj kaybolmaz." | Hepsi | Chat outbox | `mobile/src/shared/lib/chatOutbox.ts` + `chatOutbox.test.ts` | "Tam çevrimdışı çalışır" (yalnız mesaj gönderimi kuyruklanır) |
| C9 | "Uygulama Türkçe tasarlandı." | Hepsi | Tüm UI kopyası | Tek dil, `docs/ui-ux/` | "Çok dilli" |

## 2. Ölçülmemiş — yayınlanamaz

| # | Kullanılmak istenen ifade | Neden yayınlanamaz | Yayınlanabilmesi için gereken |
|---|---|---|---|
| N1 | Kullanıcı sayısı, indirme sayısı, "binlerce kişi" | Ürün henüz yayında değil | Gerçek store konsolu verisi |
| N2 | "%X daha hızlı tanışma", herhangi bir oran | Karşılaştırma tabanı yok | Aynı cihazda ölçülmüş before/after |
| N3 | Kullanıcı yorumu / testimonial | Gerçek kullanıcı yok | Gerçekten kullanmış kişinin yazılı izni |
| N4 | Yıldız/puan görseli | Store puanı yok | Store'da oluşmuş gerçek puan |
| N5 | "En iyi", "Türkiye'nin 1 numaralı" | Kanıtlanamaz üstünlük | Bağımsız, yayımlanmış karşılaştırma |
| N6 | "AI destekli eşleşme" | Ürün kural tabanlı uyumluluk skoru kullanır, model yok | `compatibility.ts` kural tabanlıdır; ifade "uyum skoru" olmalı |
| N7 | Etkinlik/oda/katılımcı sayısı | Canlı veriye bağlı, sabit değil | Yayın sonrası ölçüm, tarih damgalı |
| N8 | D1/D7 tutundurma | Ölçüm altyapısı yayında değil | Store + Sentry verisi |
| N9 | "Bilet al", "rezervasyon" | Ürün bilet satmaz | — (kapsam dışı, eklenmeyecek) |
| N10 | "Organizatör iş birliği" | Anlaşma yok | İmzalı iş birliği |

## 3. Kalıcı yasak listesi (kanıt gelse bile kullanılmaz)

- Sahte geri sayım, sahte "şu an X kişi bakıyor", sahte kıtlık.
- "Yalnız kalma", "herkes birini buldu" gibi yalnızlık sömürüsü.
- Zorunlu davet, arkadaş listesi isteme, paylaş-yoksa-devam-etme.
- Onay kutusunun varsayılan işaretli gelmesi, gizli opt-in.
- Confirmshaming ("Hayır, yalnız kalmayı tercih ederim").
- Bildirim iznini ürün akışını bloklayarak isteme.
- Gerçek ekranda olmayan bir kontrolü gösteren mockup.

## 4. Terim sözlüğü — UI ile pazarlama aynı kelimeyi kullanır

| Üründeki kelime | Pazarlamada da bu kullanılır | Kullanılmaz |
|---|---|---|
| Etkinlik | Etkinlik | Event, aktivite |
| Oda | Oda | Grup, kanal, topluluk odası |
| Eşleşme | Eşleşme | Match, bağlantı |
| Beğeni | Beğeni | Like, süper beğeni |
| İlgi alanı | İlgi alanı | Etiket, tag |
| Uyum skoru | Uyum skoru | AI skoru, algoritma puanı |

## 5. Bakım

- Her release öncesi bu tablo `quality/feature-surface.snapshot.json` ile
  karşılaştırılır; kaldırılan bir yüzeye dayanan iddia aynı PR'da silinir.
- Ölçüm eklendiğinde satır 2. bölümden 1. bölüme taşınır, tarih ve kanıt dosyası
  yazılır.
- İddia metni değişirse "son doğrulama" tarihi yenilenir.

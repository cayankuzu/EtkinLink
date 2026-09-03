# Erişilebilirlik raporu

Bu rapor, mevcut ürün yüzeyi üzerinde yapılan erişilebilirlik denetiminin sonucudur. Yeni ekran, sekme, CTA veya ayar eklenmemiştir; yalnız var olan kontrollerin rol, ad ve gruplama nitelikleri düzeltilmiştir.

Cihaz matrisi ve fiziksel doğrulama planı için [device-matrix.md](../device-matrix.md), ekran durum kapsamı için [current-screen-state-matrix.md](current-screen-state-matrix.md) kullanılır.

## Kapsam

- 74 ekran/bileşen dosyası (`mobile/src/**/*.tsx`)
- 72 dokunma hedefi (`Pressable`, `TouchableOpacity`, `TouchableHighlight`, `TouchableWithoutFeedback`)
- Ürün sözleşmesi: tek tema, Türkçe, portrait telefon

## Bulunan ve kapatılan kusurlar

React Native'de `Pressable` ve `Touchable*` ailesi varsayılan olarak `accessible={true}` gelir. iOS'ta bu, öğeyi ve içindeki her şeyi **tek bir VoiceOver düğümüne** indirger; ekranda doğru görünen bir kontrol ekran okuyucuyla erişilemez hâle gelir. Aynı örüntü dört yüzeyde farklı biçimlerde uygulanmıştı.

| # | Yüzey | Kusur | Kullanıcı etkisi | Düzeltme |
| - | ----- | ----- | ---------------- | -------- |
| 1 | `SignUpPhotosScreen` fotoğraf kaynağı sheet'i | Sheet gövdesini saran tap-blocker `Pressable` erişilebilir öğeydi | VoiceOver kullanıcısı "Kamerayı aç" / "Galeriden yükle" seçeneklerine ulaşamıyordu | `accessible={false}` + `accessibilityViewIsModal` |
| 2 | `RoomDetailScreen` oda seçenekleri sheet'i | Aynı tap-blocker örüntüsü | VoiceOver kullanıcısı oda seçeneklerinin hiçbirini etkinleştiremiyordu | `accessible={false}` |
| 3 | `DirectChatScreen` seçenek backdrop'u | Rol ve ad yoktu; yanındaki oda backdrop'unda ikisi de vardı | iOS'ta sheet'i kapatmanın erişilebilir yolu yoktu | `accessibilityRole="button"` + `accessibilityLabel="Sohbet seçeneklerini kapat"` |
| 4 | `AgeRangeSlider` track'i | Track `Pressable` iki `adjustable` thumb'ı grupluyordu | Yaş aralığının alt/üst sınırı ayrı ayrı ayarlanamıyordu | `accessible={false}` (thumb'lar zaten `adjustable` + `accessibilityValue` taşıyor) |
| 5 | `MatchFiltersScreen` premium kapısı (3 bölüm) | Kapı sarmalayıcısı chip ve alanları grupluyordu | Premium kullanıcı cinsiyet chip'lerine ve yaş alanlarına ulaşamıyordu | `accessible={!premium}`; kapı aktifken buton rolü + yükseltme mesajı hint olarak |

Düzeltmelerin tamamı yalnız erişilebilirlik nitelikleridir: hiçbir görsel, davranış, kopya veya navigasyon değişmemiştir.

## Kalıcı koruma

`mobile/scripts/check-accessibility-guards.mjs` fail-closed guard'ı her dokunma hedefi için şunu ister:

- açık bir `accessibilityRole` **ve** bir ad (`accessibilityLabel` ya da okunabilir metin çocuğu); **veya**
- açık `accessible={false}` — yani anlamı çocuklarında olan bir yerleşim/tap-blocker sarmalayıcı.

Guard satır eşleştirmesi yapmaz: JSX ifade parantezlerini ve iç içe aynı adlı etiketleri ayrıştırır, bu yüzden `accessibilityLabel={count > 0 ? 'Devam' : 'Başla'}` gibi ifadeler açılış etiketini erken sonlandırmaz.

| Kontrol | Sonuç |
| ------- | ----- |
| `npm --prefix mobile run accessibility:guards` | 74 ekran dosyası temiz |
| `npm --prefix mobile run accessibility:guards:test` | 8/8 self-test (hem kabul hem ret yolları) |
| CI | `mobile-ci.yml` → `quality` işinde fail-closed |

## Kod düzeyinde doğrulanmış diğer nitelikler

- Dokunma hedefi ölçüleri `layout.touchTarget = 48` ve `layout.compactTouchTarget = 44` tokenlarından gelir; ham piksel değeri kalmamıştır (bkz. [hardcode-and-dry-report.md](../hardcode-and-dry-report.md)).
- Ekran okuyucu adları Türkçedir ve mevcut kopyayla aynı terimleri kullanır; yeni kopya sözlüğü eklenmemiştir.
- Modal/sheet yüzeylerinde `accessibilityViewIsModal` kullanılır.
- Canlı bölgeler için `accessibilityLiveRegion="polite"` mevcut akışlarda korunur.
- Kontrast: tek tema paleti `mobile/src/shared/theme/tokens.ts` içinde merkezîdir; ham renk değeri guard'la yasaklanmıştır.

## Bu raporun kanıtlamadıkları

Aşağıdakiler yalnız fiziksel cihazda üretilebilir ve bu rapor bunları **PASS** saymaz:

- VoiceOver (iOS) ve TalkBack (Android) ile uçtan uca akış gezinmesi;
- Dynamic Type / font ölçeği %100–%200 altında taşma ve kesilme davranışı;
- Reduce Motion açıkken animasyon davranışı;
- Gerçek kontrast ölçümü (WCAG AA 4.5:1) ekran görüntüsü üzerinden;
- Klavye açıkken odak ve kaydırma davranışı.

Bu maddeler [device-matrix.md](../device-matrix.md) fiziksel doğrulama matrisinde `Bekliyor` durumundadır ve tamamlanmadan release kararı `NO-GO` kalır.

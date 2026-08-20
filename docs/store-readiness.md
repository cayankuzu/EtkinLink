# Mağaza hazırlık kapısı

## Otomatik olarak hazırlanmış kontroller

- Android production AAB yalnız production keystore değişkenleriyle imzalanır; `jarsigner -verify -strict`, R8 mapping ve resource shrinking kontrol edilir.
- iOS production IPA EAS üzerinden üretilir; `codesign --verify --deep --strict`, signed `aps-environment=production` ve paket içindeki `PrivacyInfo.xcprivacy` kontrol edilir.
- Her platformda Sentry release/source map kanıtı zorunludur.
- Android auth deep link'i, iOS URL scheme'i, fotoğraf izin açıklaması, gereksiz kaynak izinleri, telefon/portrait/light kapsamı ve iOS veri beyanları statik release guard'ındadır.
- Release job'u yalnız aynı committe başarılı mobil CI, son 7 günde başarılı gerçek staging E2E ve son 30 günde başarılı 10K yük testi artifact'ı varsa başlar.

## Dış sistemde tamamlanması gerekenler

- App Store Connect privacy cevapları, yaş derecelendirmesi, destek/gizlilik URL'leri, ekran görüntüleri ve inceleme notları;
- Google Play Data Safety, içerik derecelendirmesi, hesap silme URL'si, telefon ekran görüntüleri ve kapalı/açık test beyanları;
- production APNs/FCM/Expo kimlik bilgileri ve iki platformda gerçek cihaz push matrisi;
- production Supabase migration/lint, RLS/IDOR staging kanıtı, Sentry PII canary ve crash-free health;
- mağazaya yüklenen artifact hash'inin CI artifact hash'iyle eşitliği.

## Karar

Şu anki karar **NO-GO**'dur. Pipeline ve statik kapılar hazırlanmıştır fakat bu çalışma ortamında production secret, signed AAB/IPA, staging E2E, 10K sonuçları ve fiziksel cihaz kanıtı yoktur. Bu kanıtlar tamamlanmadan “production-ready”, “9.8/10” veya mağaza gönderimine hazır sonucu verilemez.

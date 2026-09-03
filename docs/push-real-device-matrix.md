# Push gerçek cihaz matrisi

## Ortak test koşulu

Her satır Android ve iOS fiziksel cihazda, aynı signed staging commit SHA/runtime/channel üzerinde çalışır. Her vaka için UTC başlangıç/bitiş, cihaz modeli, OS, app version/build, permission, network ve app state kaydedilir. Raw token, notification title/body/payload, credential, kullanıcı adı/e-posta veya signed URL kaydedilmez.

Mevcut ürün kapsamı dokuz notification type, dört route kind ve route'suz durumla sınırlıdır. Yeni notification type/route veya test-only kullanıcı davranışı eklenmez.

## Zorunlu matris

| Vaka                      | Android | iOS | Beklenen mevcut davranış                                                          | Zorunlu kanıt                                             |
| ------------------------- | ------- | --- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Foreground delivery       | [ ]     | [ ] | Bildirim alınır, ilgili cache invalidation bir kez çalışır                        | Video + hashed identifier + redacted event/ticket/receipt |
| Background delivery + tap | [ ]     | [ ] | Geçerli mevcut route doğru hedefe bir kez gider                                   | Önce/sonra ekran + route kind; route ID hash'i            |
| Terminated cold-start tap | [ ]     | [ ] | Navigation hazır olunca mevcut route uygulanır                                    | Cold-start video + PII'siz karar logu                     |
| Signed-out tap            | [ ]     | [ ] | İçerik açılmaz; geçerli route sign-in sonrasına ertelenir                         | Signed-out ve sign-in sonrası video                       |
| Duplicate tap/response    | [ ]     | [ ] | Aynı notification identifier ikinci kez navigate etmez                            | Tek navigation sayacı                                     |
| Geçersiz/eksik route      | [ ]     | [ ] | Navigation yapılmaz                                                               | Crash yok + route rejection                               |
| `match`                   | [ ]     | [ ] | `MessagesTab/DirectChat`                                                          | match ID hash'i + hedef                                   |
| `room`                    | [ ]     | [ ] | `RoomsTab/RoomDetail`                                                             | event ID hash'i + hedef                                   |
| `likes`                   | [ ]     | [ ] | `MatchesTab/Matches(incoming)`                                                    | hedef ekran                                               |
| `event`                   | [ ]     | [ ] | `DiscoverTab/EventDetail`                                                         | event ID hash'i + hedef                                   |
| Route'suz `system`        | [ ]     | [ ] | Yeni route türetilmez                                                             | Bildirim + navigation yokluğu                             |
| Permission deny/revoke    | [ ]     | [ ] | Yeni kayıt yapılmaz; mevcut kayıt pasifleştirmesi denenir                         | OS state + redacted `disabled_at`                         |
| Token rotation/reinstall  | [ ]     | [ ] | Yeni token kaydolur; eski token aktif claim'e girmez                              | Önce/sonra token hash'i                                   |
| `DeviceNotRegistered`     | [ ]     | [ ] | Receipt terminal `invalid_token`, token atomik pasif                              | Redacted RPC/receipt durumu                               |
| Expo ağ/429/5xx           | [ ]     | [ ] | Attempt/backoff artar; başarılı cihaz duplicate almaz                             | Attempt/lease hash'i/next-attempt                         |
| Stale receipt lease       | [ ]     | [ ] | Geç kalan sonuç `false`; yeni state değişmez                                      | RPC sonucu + before/after state                           |
| Online logout             | [ ]     | [ ] | Token unregister edilir; eski hesaba teslim yok                                   | Redacted `disabled_at` + negatif teslim                   |
| Offline logout            | [ ]     | [ ] | Eski hesaba teslim olmaması hedeflenir; mevcut best-effort risk ayrıca kaydedilir | Ağ kesme videosu + yeniden bağlanma sonrası sonuç         |
| Block/unmatch             | [ ]     | [ ] | Cache/match state yenilenir; stale message push görünmez                          | State + dedupe + cihaz teslim sonucu                      |
| Account deletion          | [ ]     | [ ] | Kullanıcının token/event/delivery FK zinciri temizlenir                           | Yalnız aggregate count                                    |

Dokuz type'ın her biri en az bir foreground delivery ile görülür. Dört route, background ve terminated tap arasında iki platformda kapsanır; hiçbir type'a repository'de olmayan route ataması yapılmaz.

## Uygulama adımları

1. Temiz tree ve SHA'yı kaydet: `git status --short` boş, `git rev-parse HEAD` manifestle aynı olmalı.
2. Aynı SHA'dan signed staging Android/iOS artifact yükle; EAS project/runtime/channel değerlerini redacted manifestte kaydet.
3. Sentetik, PII içermeyen iki staging hesabı ve yalnız mevcut domain eylemleriyle event üret.
4. Her satırdan önce app/network/permission durumunu kaydet; testi yap; DB event → ticket → receipt geçişini aynı UTC penceresinde eşleştir.
5. Token/event ID'lerini artifact yazmadan önce SHA-256 ile hashle. Videoda OS bildirim içeriğini blur et.
6. İki reviewer PASS vermeden matris tamamlanmış sayılmaz.

Mobil regresyon ön koşulu:

```powershell
npm --prefix mobile test -- --runTestsByPath src/app/navigation/notificationNavigation.test.tsx src/shared/lib/pushNotifications.test.ts
npm --prefix mobile run compatibility:guards
npm --prefix mobile run critical-flows
```

Kanıt yolu `artifacts/push/<sha>/real-device/`; `manifest.json`, platform alt klasörleri, redacted videolar, DB aggregate çıktısı, artifact checksum ve iki reviewer kaydı bulunur.

## Rollback ve durdurma koşulu

Yanlış kullanıcı/route, duplicate teslim, logout sonrası teslim, credential/PII sızıntısı veya crash görülürse testi durdur; push scheduler/trigger'ını incident runbook'a göre kapat ve outbox'ı koru. Signed mobil regresyonda aynı runtime'a ait son bilinen iyi artifact/OTA'ya dön; native permission/entitlement değişikliğini OTA ile geri almaya çalışma. Test kayıtlarını silme; erişimi incident kapsamına daralt.

## Release kararı

Her iki platformdaki bütün zorunlu satırlar aynı SHA ile PASS değilse, provider dashboard/receipt kanıtı eksikse veya offline logout riski kapanmamışsa **NO-GO**. Emülatör, unit test veya tek platform fiziksel kanıtı bu matrisin yerine geçmez.

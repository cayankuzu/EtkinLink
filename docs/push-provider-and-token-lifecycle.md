# Push provider ve token yaşam döngüsü

## Mevcut akış

1. Mobil istemci izin durumunu kontrol eder; izin varsa EAS project ID ile Expo push tokenı alır.
2. Token yalnız `ExponentPushToken[...]` veya `ExpoPushToken[...]` biçimindeyse cihaz-bağımlı Keychain/Keystore içinde recovery kaydı oluşturulur. Raw token ve user ID `AsyncStorage`'a yazılmaz; eski v1 kayıt anahtarı okunmadan silinir.
3. Authenticated `sync_push_installation` tokenı kalıcı installation UUID, platform, EAS project ID, `development|preview|production` ortamı ve uygulama sürümüyle atomik bağlar. Bir user/installation/project/environment bağında yalnız bir aktif token vardır; en çok iki önceki exact token rotation/account-switch recovery için kabul edilir.
4. Uygulama active olduğunda, native token değiştiğinde veya dropped-notification olayı geldiğinde kayıt yeniden eşitlenir. Aynı kullanıcı için single-flight ve 60 saniye cooldown vardır. Başarısız kayıt 5 sn, 15 sn, 60 sn ve 5 dk sonra toplam dört otomatik retry ile durur; yeni foreground/token olayı yeni bounded tur başlatabilir.
5. Logout ve permission kaldırma önce şifreli tombstone yazar, ardından owner-scoped `revoke_push_installation` çağırır. Ağ hatasında tombstone silinmez. Session loss ve account switch yerelde tombstone olur; sonraki authenticated sync exact token bağıyla güvenli biçimde uzlaştırır.
6. Dispatch yalnız `disabled_at is null` ve yenilenebilir 14 günlük `token_expires_at` lease'i geçerli tokenları claim eder. Bu sınır, istemcinin bir daha online olamadığı logout/session-loss vakasını server-side sonlandırır. Expo ticket/receipt `DeviceNotRegistered` döndürürse token server-side pasifleşir; receipt yolu bunu terminal receipt ile aynı DB transaction'ında yapar.
7. Account deletion profil FK zinciri üzerinden kullanıcının token/event/delivery kayıtlarını siler.

Expo provider uçları yalnız mevcut `push-dispatch` ve `push-receipts` Functions içinden çağrılır. `SUPABASE_SERVICE_ROLE_KEY`, `PUSH_WORKER_SECRET` ve `EXPO_ACCESS_TOKEN` mobil bundle'a girmez. Staging ve production credential'ları ayrıdır; secret değerleri log/artifact'e yazılmaz.

## Bilinen sınırlar

- Offline logout/session loss tombstone'u servera ancak geçerli kullanıcı oturumu yeniden kurulursa gönderilebilir. O zamana kadar 14 günlük server lease üst sınırdır; bu, anlık provider iptali kanıtı değildir.
- iOS/Android secure-storage ve uninstall davranışı OS sürümüne göre değişebilir. Kayıt yoksa yeni installation UUID üretilir; eski server kaydı lease dolana veya provider invalid-token receipt'i gelene kadar tombstone değildir.
- Kod `EXPO_ACCESS_TOKEN` yokluğunda Authorization başlığı göndermeden çalışabilir. Production provider güvenlik ayarı bunu gerektiriyorsa secret eksikliği release blocker'dır.

Bu sınırlar gizlenmez; offline logout sonrası eski hesaba push düşmediği gerçek cihazda kanıtlanana kadar release kapısı kapanmaz.

## Staging doğrulaması

Önce repo testleri:

```powershell
git rev-parse HEAD
npm --prefix mobile test -- --runTestsByPath src/shared/lib/pushNotifications.test.ts src/features/auth/sessionStore.test.ts
npx --yes deno@2.9.6 test --frozen --node-modules-dir=auto supabase/functions/push-dispatch/index.test.ts supabase/functions/push-receipts/index.test.ts
```

Protected staging ortamında secret **adlarını**, değerlerini değil, doğrula ve aynı SHA'yı deploy et:

```powershell
npx supabase@2.115.0 secrets list --project-ref <STAGING_PROJECT_REF>
npx supabase@2.115.0 functions deploy push-dispatch --project-ref <STAGING_PROJECT_REF>
npx supabase@2.115.0 functions deploy push-receipts --project-ref <STAGING_PROJECT_REF>
```

Fiziksel Android ve iOS'ta şu sırayı uygula: clean install → izin ver → token kaydı → foreground/background/terminated sentetik bildirim → tap → token rotation/reinstall → permission revoke → online logout → offline logout → `DeviceNotRegistered`. DB kanıtı yalnız redacted aggregate, token hash'i ve durum zamanlarını içermelidir; raw Expo tokenı veya notification içeriği dışa aktarma.

Kanıt yolu: `artifacts/push/<sha>/provider-token/`. Manifestte SHA, app version/build, runtime/channel, EAS project ID hash'i, cihaz/OS, permission/app/network state, UTC zaman aralığı, tester/reviewer ve redacted dosya hash'leri bulunur.

## Rollback

Provider veya token regresyonunda yeni gönderimi durdur; outbox'ı silme. Son bilinen iyi, aynı RPC sözleşmesiyle uyumlu iki Function SHA'sını birlikte deploy et. Credential değiştiyse yalnız non-compromised önceki credential'a dön; compromised secret'ı geri açma. Disabled tokenı SQL ile manuel canlandırma; istemcinin authenticated yeniden kaydını bekle. Mobil rollback yalnız aynı native runtime ile uyumlu imzalı artifact/OTA üzerinden yapılır.

## Release kararı

Unit/Function testleri provider teslimini, APNs/FCM entitlement'ını, token rotation'ı veya offline logout güvenliğini kanıtlamaz. Android+iOS fiziksel matrix, gerçek ticket+receipt, eski tokenın gönderim dışı kaldığı ve logout sonrası teslim yokluğu aynı SHA'da yoksa **NO-GO**.

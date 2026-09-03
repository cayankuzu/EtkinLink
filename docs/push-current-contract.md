# Push mevcut sözleşmesi

## Amaç ve kaynaklar

Bu belge yalnız repository'de zaten bulunan push yüzeyini sabitler. Yeni notification type, channel, route, ekran veya kullanıcı tercihi tanımlamaz. Kaynaklar:

- tür, tercih, outbox ve token RPC'leri: `supabase/migrations/20260809160000_push_notifications.sql`;
- `blocked`/`unblocked` üretimi: `supabase/migrations/20260809170000_wmatch_notification_parity.sql`;
- HMAC worker, scheduler ve claim: `supabase/migrations/20260819100000_push_worker_hardening.sql` ve `20260830140000_push_delivery_hardening.sql`;
- durable receipt lease/CAS: `supabase/migrations/20260831160000_push_receipt_lease_and_kind_contract.sql`;
- secure installation lifecycle/lease: `supabase/migrations/20260831170000_push_installation_lifecycle.sql`;
- mobil yönlendirme: `mobile/src/app/navigation/notificationNavigation.ts`;
- sabit feature snapshot: `quality/feature-surface.snapshot.json`.

## Değişmez ürün yüzeyi

Mevcut notification type listesi tam olarak şudur: `new_like`, `new_match`, `direct_message`, `room_message`, `match_ended`, `event_reminder`, `system`, `blocked`, `unblocked`.

`blocked` ve `unblocked` yeni değildir. İlk production schema'daki `public.notification_kind` enum'u, feature snapshot, mobil cache invalidation ve mevcut match-change trigger'ı iki değeri de içerir. Forward-only `notification_events_kind` CHECK değişikliği yalnız outbox constraint'ini bu sözleşmeyle eşitler.

| Sözleşme           | İzin verilen değer/işlem                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| Route kind         | `match`, `room`, `likes`, `event` veya `null`                             |
| Android channel    | `messages-v2`, `rooms-v2`, `matches-v2`, `events-v2`, `system-v2`         |
| DB channel kimliği | `messages`, `rooms`, `matches`, `events`, `system`                        |
| Event durumu       | `pending`, `processing`, `sent`, `failed`, `cancelled`                    |
| Receipt durumu     | `pending`, `delivered`, `invalid_token`, `retryable`, `permanent_failure` |

Mobil route davranışı da sabittir:

| Route                  | Mevcut hedef                                       |
| ---------------------- | -------------------------------------------------- |
| `match` + geçerli UUID | `MessagesTab` → `DirectChat(matchId)`              |
| `room` + geçerli UUID  | `RoomsTab` → `RoomDetail(eventId)`                 |
| `likes`                | `MatchesTab` → `Matches(section: incoming)`        |
| `event` + geçerli UUID | `DiscoverTab` → `EventDetail(eventId)`             |
| eksik/geçersiz route   | Veri invalidation yapılabilir; navigation yapılmaz |

Tap identifier aynı process içinde bir kez işlenir. Kullanıcı signed-out veya navigation hazır değilse geçerli route bellekte bekler ve sign-in/navigation hazır olduğunda uygulanır. `system` için yeni route türetilmez.

## Doğrulama komutları

Aynı temiz commit SHA üzerinde:

```powershell
git rev-parse HEAD
node scripts/guards/check-no-new-product-surface.mjs
npm --prefix mobile test -- --runTestsByPath src/app/navigation/notificationNavigation.test.tsx src/shared/lib/pushNotifications.test.ts
npx --yes deno@2.9.6 test --frozen --node-modules-dir=auto supabase/functions/push-dispatch/index.test.ts supabase/functions/push-receipts/index.test.ts
```

İzole DB/CI ortamında:

```bash
supabase db start
supabase db lint --local --schema public --level warning --fail-on warning
supabase test db --local
supabase stop --no-backup
```

Beklenen kanıt: feature-freeze guard başarılı; mobil route/token testleri başarılı; Function testleri başarılı; `push_delivery_hardening.sql` plan/assertion sayısı eş ve bütün pgTAP sonuçları başarılı. Çıktıları `artifacts/push/<sha>/contract/` altında sakla; token, title, body, payload, secret veya signed URL ekleme.

## Rollback

Sözleşme genişletilmez veya eski tür silinmez. Hatalı Function deploy'unda aynı schema/RPC ile uyumlu son bilinen iyi Function SHA'sına dön; forward-only migration'ı production'da geri alma veya DB reset yapma. Route regresyonunda yalnız mobil artifact/OTA uygunluk kurallarına göre önceki aynı-runtime sürümüne dön; notification type/route DB verisini yeniden yazma.

## Release kararı

Repository testleri sözleşmeyi kanıtlar, gerçek provider ve cihaz teslimini kanıtlamaz. Aynı SHA'ya bağlı staging DB, Android+iOS fiziksel delivery/tap ve redacted provider kanıtı yoksa push release **NO-GO** kalır.

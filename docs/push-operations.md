# Push operasyonları

Bu sayfa mevcut EtkinLink push sözleşmesinin operasyon indeksidir. Ayrıntılar aşağıdaki exact teslimatlarda tek sahipliktedir:

1. [Mevcut tür, route ve channel sözleşmesi](./push-current-contract.md)
2. [Expo/provider ve token yaşam döngüsü](./push-provider-and-token-lifecycle.md)
3. [Outbox, retry, receipt lease ve logical DLQ](./push-outbox-retry-receipt-dlq.md)
4. [Android/iOS gerçek cihaz matrisi](./push-real-device-matrix.md)
5. [Incident ve credential rotation runbook](./push-incident-and-credential-rotation-runbook.md)

## Hızlı kalite kapısı

```powershell
git rev-parse HEAD
node scripts/guards/check-no-new-product-surface.mjs
npm --prefix mobile test -- --runTestsByPath src/app/navigation/notificationNavigation.test.tsx src/shared/lib/pushNotifications.test.ts
npx --yes deno@2.9.6 fmt --check supabase/functions
npx --yes deno@2.9.6 lint supabase/functions
npx --yes deno@2.9.6 check --frozen --node-modules-dir=auto supabase/functions/*/index.ts
npx --yes deno@2.9.6 test --frozen --node-modules-dir=auto supabase/functions/**/*.test.ts
```

DB lint/pgTAP izole CI veya yerel Supabase ortamında ayrıca geçmelidir. Production DB resetlenmez; migration forward-only kalır.

## Ortak güvenlik sınırı

- Notification type listesi yalnız mevcut dokuz değer, route listesi yalnız `match`, `room`, `likes`, `event` veya `null`dır.
- PostgreSQL outbox tek durable source of truth'tür; ikinci queue/scheduler eklenmez.
- Token, title, body, payload, secret, HMAC veya signed URL log/artifact'e yazılmaz.
- Satır silme, attempt sıfırlama, lease değiştirme ve disabled tokenı SQL ile canlandırma yasaktır.
- Function rollback yalnız mevcut DB lease/RPC sözleşmesiyle uyumlu bir SHA'ya yapılır; production migration geri alınmaz.

## Kanıt ve karar

Normal release kanıtı `artifacts/push/<sha>/`, incident kanıtı `artifacts/incidents/<incident-id>/push/` altında, aynı immutable SHA'ya bağlı ve redacted tutulur.

Repo testleri tamamlanmış olsa bile staging DB lint/pgTAP, gerçek Expo/APNs/FCM ticket+receipt, Android+iOS foreground/background/terminated delivery+tap, token rotation/logout ve alarm/rotation tatbikatı aynı SHA'da yoksa sonuç:

`IMPLEMENTATION COMPLETE, RELEASE NO-GO UNTIL LISTED MANUAL/RUNTIME EVIDENCE IS ATTACHED TO THE SAME COMMIT SHA.`

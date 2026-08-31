# Yeni ürün yüzeyi eklememe denetimi

## Baseline

Başlangıç commit'i `f8a1e48de47d49021ea092c609440240fd13e23d` için yüzey sözleşmesi `quality/feature-surface.snapshot.json` dosyasına kaydedildi. Snapshot 5 tab, 43 stack route, 39 ekran entrypoint'i, 15 mevcut modal, native izin/capability'ler, dokuz mevcut notification type, 26 public tablo ve mevcut Settings satırlarını kapsar.

## Fail-closed guard

Kök dizinden çalıştır:

```powershell
node scripts/guards/check-no-new-product-surface.mjs
node scripts/guards/check-no-new-product-surface.mjs --self-test
```

Guard yeni veya eksik route/tab/Screen/modal, native permission/plugin/entitlement/scheme, notification type, Settings grup/satırı, ürün tablosu veya ürün Edge Function'ında non-zero çıkar. Yalnız adı açıkça internal security/ops/audit/telemetry/outbox/delivery sözleşmesine uyan tablo ve `-internal`, `-ops`, `-worker`, `-webhook` son ekli işlevler dar allowlist'tedir. Bu allowlist kullanıcı ekranı, CTA veya ürün domain'i eklemeye izin vermez.

Guard'ın güncellenmesi tek başına yeni yüzeye izin vermez. Ürün değişikliği gerekirse bu görev kapsamında uygulanmaz ve `OUT OF SCOPE — PRODUCT DECISION REQUIRED` olarak raporlanır.

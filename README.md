# EtkinLink

Etkinlik etrafında güvenli sosyalleşme ve eşleşme platformu. Bu depo, saf mobil React Native istemcisini ve Supabase backend sözleşmelerini içerir.

## Yapı

- `mobile/`: React Native 0.86, React 19 ve strict TypeScript istemcisi
- `supabase/migrations/`: PostgreSQL şeması, RLS, atomik RPC'ler ve read model'ler
- `supabase/functions/ingest-events/`: `https://etkinlik.io/rss/sorgu` kaynağından sunucu taraflı etkinlik aktarımı
- `docs/`: mimari, güvenlik, dağıtım ve kalite kanıtları

## Hızlı başlangıç

1. `mobile/.env.example` dosyasını `mobile/.env` olarak kopyala.
2. Yalnızca Supabase URL'sini ve `sb_publishable_...` anahtarını ekle. Secret/service-role anahtarı mobil istemciye girmez.
3. `npm install`
4. `npm start`
5. Ayrı terminalde `npm run android`

Bu proje Expo SDK modüllerini kullanan prebuild/bare React Native uygulamasıdır. Kök dizindeki `npm start`, Expo development client için Metro'yu `mobile/` paketi üzerinden başlatır; native Android ve iOS projeleri sürüm kontrolünde tutulur.

Güncel debug APK `mobile` dizininde `npm run build:debug` ile üretilir; release paketi yalnızca CI secret store'daki production imza bilgileriyle oluşturulabilir.

## Kalite kapısı

```powershell
npm run verify
npm run test:coverage
npm audit --omit=dev
```

Supabase için tekrarlanabilir migration, lint, pgTAP ve güvenli dağıtım adımları [Supabase dağıtım belgesinde](docs/supabase-deployment.md) yer alır. Yeni migration'lar linked ortama uygulanmadan remote şema güncel kabul edilmez.

Runtime'da etkinlik veya kullanıcı mock verisi bulunmaz. Etkinlik kayıtları yalnızca `https://etkinlik.io/rss/sorgu` kaynağından sunucu tarafında alınır ve kaynakta gerçek HTTPS görseli olmayan kayıtlar yayınlanmaz. Şehirler ve ilgi alanları kullanıcı üretimi olmayan sabit referans verileridir.

## Operasyon belgeleri

- [Production hazırlık özeti](docs/production-readiness.md)
- [Mağaza hazırlık kapısı](docs/store-readiness.md)
- [Push operasyonları](docs/push-operations.md)
- [Monitoring runbook](docs/monitoring-runbook.md)
- [Cihaz matrisi](docs/device-matrix.md)
- [Gizlilik veri envanteri](docs/privacy-data-inventory.md)
- [Google Play Data Safety eşlemesi](docs/google-play-data-safety.md)

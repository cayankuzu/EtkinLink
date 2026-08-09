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

Bu proje Expo değil, bare React Native projesidir. Proje kökünde `npx expo start` kullanılmaz. Kök dizinde doğrudan `npm start` komutu Metro'yu `mobile/` paketi için başlatır.

Masaüstündeki debug APK: `C:\Users\Cayan\Desktop\EtkinLink-debug.apk`

## Kalite kapısı

```powershell
npm run verify
npm run test:coverage
npm audit --omit=dev
```

Supabase migration'ları bağlı EtkinLink projesine uygulanmış, remote lint temizlenmiş ve etkinlik aktarım fonksiyonu doğrulanmıştır. Tekrarlanabilir güvenli dağıtım adımları [Supabase dağıtım belgesinde](docs/supabase-deployment.md) yer alır.

Runtime'da etkinlik veya kullanıcı mock verisi bulunmaz. Etkinlik kayıtları yalnızca `https://etkinlik.io/rss/sorgu` kaynağından sunucu tarafında alınır ve kaynakta gerçek HTTPS görseli olmayan kayıtlar yayınlanmaz. Şehirler ve ilgi alanları kullanıcı üretimi olmayan sabit referans verileridir.

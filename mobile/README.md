# EtkinLink Mobile

EtkinLink, React Native 0.86 ve Expo SDK 57 modülleriyle geliştirilen iOS/Android uygulamasıdır. Native projeler repoda tutulur; geliştirme Expo development client ile yapılır.

## Yerel çalışma

```bash
npm ci
npm start
npm run android
```

iOS native build için macOS ve Xcode gerekir.

## Kalite kapıları

```bash
npm run verify
npm run test:coverage
npm run audit:production
npm run release:check
```

`verify`; typecheck, lint, format, mimari sınırlar, dead-code, güvenlik guardları, performans bütçesi, kritik akış kanıtları ve Jest testlerini birlikte çalıştırır.

Production release, debug anahtarıyla üretilemez. Android signing değişkenleri, Sentry DSN/auth token ve EAS kimlik bilgileri yalnızca CI secret store üzerinden sağlanır. Gerçek değerler `.env` veya repoya yazılmaz.

Bare workflow nedeniyle `runtimeVersion` açık bir stringdir ve uygulama sürümüyle aynı tutulur. Native uyumluluğu bozan her değişiklikte ikisi birlikte artırılır ve önce aynı commit SHA'dan yeni Android/iOS binary yayımlanır; yalnız aynı runtime içindeki JavaScript/TypeScript ve uyumlu asset değişiklikleri OTA olabilir.

Uygulama bilinçli olarak Türkçe ve açık tema kapsamındadır.

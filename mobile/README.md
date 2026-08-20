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

Bare workflow nedeniyle `app.json` içindeki `runtimeVersion` açık bir stringdir. Native uyumluluğu bozan değişikliklerde bu değer bilinçli olarak artırılmalı; `{ "policy": "appVersion" }` kullanılmamalıdır.

Uygulama bilinçli olarak Türkçe ve açık tema kapsamındadır.

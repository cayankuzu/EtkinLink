import { readFileSync } from 'node:fs';

const appConfig = JSON.parse(
  readFileSync(new URL('../app.json', import.meta.url)),
);
const release = `etkinlink-mobile@${appConfig.expo.version}`;
const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} eksik.`);
}

const baseUrl = (
  process.env.SENTRY_API_BASE_URL || 'https://sentry.io'
).replace(/\/$/u, '');
const endpoint = `${baseUrl}/api/0/projects/${encodeURIComponent(
  process.env.SENTRY_ORG,
)}/${encodeURIComponent(
  process.env.SENTRY_PROJECT,
)}/releases/${encodeURIComponent(release)}/files/`;

let lastError = null;
for (let attempt = 0; attempt < 6; attempt += 1) {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
  });
  if (response.ok) {
    const files = await response.json();
    if (Array.isArray(files) && files.length > 0) {
      console.log(
        `${release} için ${files.length} Sentry source-map/release dosyası doğrulandı.`,
      );
      process.exit(0);
    }
    lastError = new Error(`${release} source-map dosyası içermiyor.`);
  } else {
    lastError = new Error(
      `Sentry release doğrulaması HTTP ${response.status} döndürdü.`,
    );
  }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
throw lastError;

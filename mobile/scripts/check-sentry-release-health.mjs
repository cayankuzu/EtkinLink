const required = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} eksik.`);
}

const apiBase = (
  process.env.SENTRY_API_BASE_URL || 'https://sentry.io'
).replace(/\/$/u, '');
const org = encodeURIComponent(process.env.SENTRY_ORG);
const projectSlug = encodeURIComponent(process.env.SENTRY_PROJECT);
const headers = { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` };
const threshold = Number(process.env.SENTRY_CRASH_FREE_THRESHOLD || '99.5');

async function get(path) {
  const response = await fetch(`${apiBase}${path}`, { headers });
  if (!response.ok)
    throw new Error(`Sentry health API HTTP ${response.status}.`);
  return response.json();
}

function findCrashFreeRate(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'crash_free_rate(session)' && Number.isFinite(Number(nested))) {
      return Number(nested);
    }
    const found = findCrashFreeRate(nested);
    if (found !== null) return found;
  }
  return null;
}

if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
  throw new Error('SENTRY_CRASH_FREE_THRESHOLD 0-100 arasında olmalı.');
}

const project = await get(`/api/0/projects/${org}/${projectSlug}/`);
const query = new URLSearchParams({
  field: 'crash_free_rate(session)',
  project: String(project.id),
  environment: 'production',
  statsPeriod: '24h',
  interval: '1h',
});
const health = await get(`/api/0/organizations/${org}/sessions/?${query}`);
const crashFreeRate = findCrashFreeRate(health);
if (crashFreeRate === null) {
  if (process.env.SENTRY_REQUIRE_HEALTH_DATA === 'true') {
    throw new Error('Production crash-free session verisi bulunamadı.');
  }
  console.log('Henüz production crash-free session verisi yok.');
  process.exit(0);
}
if (crashFreeRate < threshold) {
  throw new Error(
    `Crash-free session %${crashFreeRate.toFixed(3)}; eşik %${threshold}.`,
  );
}
console.log(
  `Crash-free session %${crashFreeRate.toFixed(
    3,
  )} ile %${threshold} eşiğini geçti.`,
);

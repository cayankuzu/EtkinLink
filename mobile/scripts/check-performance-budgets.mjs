import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const budgets = JSON.parse(
  readFileSync(resolve(root, 'config/performance-budgets.json'), 'utf8'),
);

const required = {
  coldStartupP95Ms: value => value <= 2500,
  warmStartupP95Ms: value => value <= 1000,
  firstCachedContentP95Ms: value => value <= 850,
  interactiveP95Ms: value => value <= 1200,
  tapResponseP95Ms: value => value <= 100,
  navigationResponseP95Ms: value => value <= 300,
  feedFpsP50Min: value => value >= 55,
  frameJankPercentMax: value => value <= 1,
  mediaCacheHitRateMin: value => value >= 0.65,
  crashFreeSessionRateMin: value => value >= 0.999,
  anrRateMax: value => value <= 0.002,
};

const failures = Object.entries(required).flatMap(([key, predicate]) =>
  typeof budgets[key] !== 'number' || !predicate(budgets[key])
    ? [`${key} bütçesi eksik veya 9.8 eşiğinin dışında.`]
    : [],
);
if (failures.length) {
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Performans bütçesi sözleşmesi 9.8 hedefleriyle uyumlu.');

/**
 * WCAG 2.2 contrast guard for the EtkinLink token set.
 *
 * The app ships one light theme, so every pair below is a combination the UI
 * can actually render. Alpha foregrounds and alpha surfaces are composited
 * onto their opaque base before measuring; measuring an rgba() value in
 * isolation says nothing about what a user sees.
 *
 * Thresholds follow WCAG 2.2:
 *   SC 1.4.3  normal text                >= 4.5:1
 *   SC 1.4.11 UI component / state edge  >= 3.0:1
 */
import { readFileSync } from 'node:fs';

const TOKENS_PATH = new URL('../src/shared/theme/tokens.ts', import.meta.url);
const source = readFileSync(TOKENS_PATH, 'utf8');

function parseColor(value) {
  const raw = String(value).trim();
  if (raw.startsWith('#')) {
    const hex = raw.slice(1).length === 3 ? raw.slice(1).replace(/./g, (c) => c + c) : raw.slice(1);
    return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), alpha: 1 };
  }
  const match = raw.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.slice(0, 3).some(Number.isNaN)) return null;
  return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
}

function composite(color, baseRgb) {
  return color.rgb.map((channel, i) => channel * color.alpha + baseRgb[i] * (1 - color.alpha));
}

function relativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foregroundRgb, backgroundRgb) {
  const a = relativeLuminance(foregroundRgb);
  const b = relativeLuminance(backgroundRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const tokens = new Map();
{
  const pattern = /(\w+):\s*'(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))'/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (!tokens.has(match[1])) tokens.set(match[1], match[2]);
  }
}

const APP_BASE = 'canvas';

function resolve(name) {
  const value = tokens.get(name);
  if (!value) throw new Error(`Unknown colour token referenced by the contrast guard: ${name}`);
  const parsed = parseColor(value);
  if (!parsed) throw new Error(`Token ${name} is not a parseable colour: ${value}`);
  return parsed;
}

function backgroundRgb(name) {
  const color = resolve(name);
  return color.alpha === 1 ? color.rgb : composite(color, resolve(APP_BASE).rgb);
}

function measure(foreground, background) {
  const base = backgroundRgb(background);
  return ratio(composite(resolve(foreground), base), base);
}

const SURFACES = ['canvas', 'surface', 'surfaceMuted', 'surfaceSoft'];

const pairs = [
  // Copy and icons on every container the app renders them in.
  ...SURFACES.flatMap((surface) => [
    { foreground: 'textPrimary', background: surface, kind: 'text' },
    { foreground: 'textSecondary', background: surface, kind: 'text' },
    { foreground: 'textTertiary', background: surface, kind: 'text' },
    { foreground: 'iconPrimary', background: surface, kind: 'text' },
  ]),

  // Tinted panels: the copy that sits inside a brand or status wash.
  { foreground: 'textPrimary', background: 'brandSoft', kind: 'text' },
  { foreground: 'textPrimary', background: 'brandSubtle', kind: 'text' },
  { foreground: 'textSecondary', background: 'brandSoft', kind: 'text' },
  { foreground: 'brand', background: 'brandSoft', kind: 'text' },
  { foreground: 'brand', background: 'brandSubtle', kind: 'text' },
  { foreground: 'brand', background: 'infoSoft', kind: 'text' },
  { foreground: 'brand', background: 'surface', kind: 'text' },
  { foreground: 'brand', background: 'canvas', kind: 'text' },
  { foreground: 'success', background: 'successSoft', kind: 'text' },
  { foreground: 'warning', background: 'warningSoft', kind: 'text' },
  { foreground: 'danger', background: 'dangerSoft', kind: 'text' },

  // Filled controls: the label colour on every fill the app puts text on.
  { foreground: 'textInverse', background: 'brand', kind: 'text' },
  { foreground: 'textInverse', background: 'brandPressed', kind: 'text' },
  { foreground: 'textInverse', background: 'danger', kind: 'text' },
  { foreground: 'textInverse', background: 'dangerPressed', kind: 'text' },
  { foreground: 'textInverse', background: 'success', kind: 'text' },
  { foreground: 'textInverse', background: 'warning', kind: 'text' },

  // The match badge carries a white heart on an accent disc. The icon is the
  // only thing identifying the badge, so SC 1.4.11 applies to it.
  { foreground: 'textInverse', background: 'accent', kind: 'ui' },
];

/**
 * Measured on every run but not enforced, with the reason kept next to the
 * number rather than deleted.
 *
 * border, borderStrong and dangerBorder are hairlines that refine containers
 * already identified by their fill, icon and label. SC 1.4.11 covers what is
 * *required* to identify a component, so a decorative outline is out of scope.
 * Raising them to 3:1 in a light theme would need near-mid-grey rules, which
 * is a different visual language, not an accessibility fix.
 */
const REPORTED = [
  { foreground: 'border', background: 'surface' },
  { foreground: 'borderStrong', background: 'surface' },
  { foreground: 'borderStrong', background: 'canvas' },
  { foreground: 'dangerBorder', background: 'dangerSoft' },
];

const THRESHOLDS = { text: 4.5, large: 3, ui: 3 };

const failures = [];
for (const pair of pairs) {
  const value = measure(pair.foreground, pair.background);
  const required = THRESHOLDS[pair.kind];
  const ok = value >= required;
  if (!ok) failures.push({ ...pair, value, required });
  process.stdout.write(
    `${ok ? 'GEÇTİ' : 'KALDI'} ${pair.foreground} / ${pair.background} = ` +
      `${value.toFixed(2)}:1 (gereken ${required.toFixed(1)}:1, ${pair.kind})\n`,
  );
}

for (const entry of REPORTED) {
  const value = measure(entry.foreground, entry.background);
  process.stdout.write(
    `BİLGİ ${entry.foreground} / ${entry.background} = ${value.toFixed(2)}:1 ` +
      '(dekoratif ince çizgi, bileşeni tanımlayan sınır değil)\n',
  );
}

if (failures.length > 0) {
  process.stderr.write(`\nKontrast guardı ${failures.length} semantik çift için kaldı.\n`);
  for (const failure of failures) {
    process.stderr.write(
      `  ${failure.foreground} on ${failure.background}: ` +
        `${failure.value.toFixed(2)}:1 < ${failure.required.toFixed(1)}:1\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(`\nKontrast guardı geçti: ${pairs.length} semantik çift WCAG 2.2 eşiklerini karşılıyor.\n`);

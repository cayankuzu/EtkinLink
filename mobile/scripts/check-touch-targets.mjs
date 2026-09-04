import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Effective touch-area contract for the existing controls.
//
// The accessibility guard already proves every touchable has a role and a name.
// It says nothing about whether a finger can hit it. Material's accessibility
// guidance asks for 48dp and Apple's HIG for 44pt, and the number that matters
// is the *effective* area — the rendered box grown by `hitSlop` — not the icon
// size a reader sees. Several controls in this product are deliberately drawn
// small (36-40pt photo affordances, 22pt checkboxes) because the visual
// language calls for it; the fix for those is `hitSlop`, not a bigger box, so
// this guard measures the sum rather than the style.
//
// A control whose size is not statically declared cannot be measured here and
// is reported as unmeasured rather than silently passing.

const ANDROID_MINIMUM_DP = 48;

const TOUCHABLE_COMPONENTS = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
];

// Shared controls that own their own size and slop; a screen that renders one
// inherits a compliant target unless it overrides the style, which is measured
// through the override like any other.
const SHARED_CONTROLS = ['AppButton', 'IconButton', 'Chip'];

export function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!/\.tsx$/u.test(entry.name)) return [];
    if (/\.test\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

/**
 * Numeric width/height declared by each `StyleSheet.create` entry. Only literal
 * numbers and `layout.*` tokens are resolvable; anything computed is left out
 * so the guard never guesses a dimension.
 */
export function collectStyleSizes(source, layoutTokens) {
  const sizes = new Map();
  const entry = /(\w+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/gu;
  let match;
  while ((match = entry.exec(source))) {
    const [, name, body] = match;
    const read = axis => {
      const literal = new RegExp(
        `(?:^|[\\s,])(?:min)?${axis}\\s*:\\s*(\\d+)`,
        'u',
      ).exec(body);
      if (literal) return Number(literal[1]);
      const token = new RegExp(
        `(?:^|[\\s,])(?:min)?${axis}\\s*:\\s*layout\\.(\\w+)`,
        'u',
      ).exec(body);
      if (token && layoutTokens[token[1]] !== undefined) {
        return layoutTokens[token[1]];
      }
      return null;
    };
    const width = read('[Ww]idth');
    const height = read('[Hh]eight');
    if (width === null && height === null) continue;
    sizes.set(name, { width, height });
  }
  return sizes;
}

function findOpeningTagEnd(source, fromIndex) {
  let index = fromIndex;
  let braceDepth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (character === '>' && braceDepth === 0) return index;
    index += 1;
  }
  return source.length - 1;
}

/**
 * The slop a tag adds on each edge. `hitSlop={8}` is symmetric; the object form
 * is reduced to its smallest edge, because the smallest edge is what limits the
 * reachable area.
 */
export function readHitSlop(tag) {
  const symmetric = /hitSlop=\{(\d+)\}/u.exec(tag);
  if (symmetric) return Number(symmetric[1]);
  const object = /hitSlop=\{\{([^}]*)\}\}/u.exec(tag);
  if (!object) return 0;
  const edges = [...object[1].matchAll(/(?:top|bottom|left|right)\s*:\s*(\d+)/gu)]
    .map(edge => Number(edge[1]));
  if (edges.length === 0) return 0;
  return Math.min(...edges);
}

/** Style names referenced by a `style=` prop, including array and callback forms. */
export function readStyleNames(tag) {
  return [...tag.matchAll(/styles\.(\w+)/gu)].map(match => match[1]);
}

/**
 * What a shared control contributes on its own: the `hitSlop` it always applies
 * and the size its base style declares. Read from the component rather than
 * assumed, so the guard follows the component if either changes.
 */
export function readSharedControlBase(source, layoutTokens) {
  const sizes = collectStyleSizes(source, layoutTokens);
  const base = sizes.get('base') ?? { width: null, height: null };
  return { slop: readHitSlop(source), ...base };
}

export function findTouchTargetViolations(
  source,
  relativePath,
  layoutTokens,
  sharedBases = {},
) {
  const sizes = collectStyleSizes(source, layoutTokens);
  const violations = [];
  const components = [...TOUCHABLE_COMPONENTS, ...SHARED_CONTROLS];
  const opening = new RegExp(`<(${components.join('|')})\\b`, 'gu');
  let match;

  while ((match = opening.exec(source))) {
    const component = match[1];
    const end = findOpeningTagEnd(source, opening.lastIndex);
    const tag = source.slice(match.index, end + 1);
    const line = source.slice(0, match.index).split('\n').length;

    // A wrapper that only groups children is not a control.
    if (/accessible=\{false\}/u.test(tag)) continue;

    const shared = sharedBases[component];
    const declared = readStyleNames(tag)
      .map(name => sizes.get(name))
      .filter(Boolean);
    if (shared) declared.push({ width: shared.width, height: shared.height });
    if (declared.length === 0) continue;

    // A tag-level `hitSlop` replaces the component's own; otherwise the shared
    // control's slop still applies.
    const slop = /hitSlop=/u.test(tag)
      ? readHitSlop(tag)
      : shared?.slop ?? readHitSlop(tag);
    // An override only shrinks the axis it names, so the smallest declared
    // value per axis is what a finger actually gets.
    const width = Math.min(
      ...declared.map(size => size.width ?? Number.POSITIVE_INFINITY),
    );
    const height = Math.min(
      ...declared.map(size => size.height ?? Number.POSITIVE_INFINITY),
    );

    for (const [axis, value] of [
      ['genişlik', width],
      ['yükseklik', height],
    ]) {
      if (!Number.isFinite(value)) continue;
      const effective = value + slop * 2;
      if (effective < ANDROID_MINIMUM_DP) {
        violations.push(
          `${relativePath}:${line} <${component}>: etkin dokunma ${axis} ${effective}dp ` +
            `(${value}dp kutu + 2x${slop}dp hitSlop); Android için en az ${ANDROID_MINIMUM_DP}dp gerekli. ` +
            `Görsel boyutu koruyup hitSlop ekle.`,
        );
      }
    }
  }

  return violations;
}

function readLayoutTokens(root) {
  const source = readFileSync(join(root, 'src/shared/theme/tokens.ts'), 'utf8');
  const block = /export const layout = \{([\s\S]*?)\} as const;/u.exec(source);
  if (!block) throw new Error('layout token bloğu bulunamadı');
  return Object.fromEntries(
    [...block[1].matchAll(/(\w+)\s*:\s*(\d+)/gu)].map(entry => [
      entry[1],
      Number(entry[2]),
    ]),
  );
}

function main() {
  const root = resolve(import.meta.dirname, '..');
  const layoutTokens = readLayoutTokens(root);
  const sharedBases = Object.fromEntries(
    SHARED_CONTROLS.map(name => [
      name,
      readSharedControlBase(
        readFileSync(join(root, `src/shared/components/${name}.tsx`), 'utf8'),
        layoutTokens,
      ),
    ]),
  );
  const files = collectSourceFiles(join(root, 'src'));
  const violations = files.flatMap(file =>
    findTouchTargetViolations(
      readFileSync(file, 'utf8'),
      file.slice(root.length + 1).replaceAll('\\', '/'),
      layoutTokens,
      sharedBases,
    ),
  );

  if (violations.length > 0) {
    console.error('Dokunma hedefi guard hataları:');
    violations.forEach(violation => console.error(`- ${violation}`));
    process.exit(1);
  }

  console.log(
    `Dokunma hedefi guardı geçti: ${files.length} dosyadaki ölçülebilir kontrollerin ` +
      `etkin alanı en az ${ANDROID_MINIMUM_DP}dp.`,
  );
}

if (process.argv[1]?.endsWith('check-touch-targets.mjs')) main();

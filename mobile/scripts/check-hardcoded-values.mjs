import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Literal-value contract for the mobile source.
//
// Two classes of value drift silently when written inline, so both are
// centralised and enforced here.
//
// Colours: the product has one theme, and every colour a screen paints must
// come from `src/shared/theme/tokens.ts` so contrast, the dark media surfaces
// and the glass controls stay consistent. This repository had two different
// near-black media canvases and four different white glass alphas for the same
// visual role, plus two verbatim copies of the `overlay` token.
//
// Page sizes: a request bound written inline stops matching the shared
// contract. `messageService` and `roomService` each imported
// `paginationLimits` and then wrote `35` inline next to it, so the thread page
// size existed in three places at once.
//
// The theme and limits modules are the one place these literals may live.

const THEME_MODULE = 'src/shared/theme/tokens.ts';
const LIMITS_MODULE = 'src/shared/constants/limits.ts';

const PAGE_SIZE_LITERAL = /\.limit\(\s*\d+\s*\)|\bpage_size\s*:\s*\d+|\bpageSize\s*:\s*\d+/u;

const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/u;

export function collectStyleSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectStyleSources(path);
    if (!/\.tsx?$/u.test(entry.name)) return [];
    if (/\.test\.tsx?$/u.test(entry.name)) return [];
    return [path];
  });
}

export function findColorLiterals(source, relativePath) {
  if (relativePath === THEME_MODULE) return [];
  return source
    .split('\n')
    .flatMap((line, index) =>
      COLOR_LITERAL.test(line)
        ? [
            `${relativePath}:${index + 1}: ${line.trim()} — @shared/theme tokenı kullan.`,
          ]
        : [],
    );
}

export function findPageSizeLiterals(source, relativePath) {
  if (relativePath === LIMITS_MODULE) return [];
  return source
    .split('\n')
    .flatMap((line, index) =>
      PAGE_SIZE_LITERAL.test(line)
        ? [
            `${relativePath}:${index + 1}: ${line.trim()} — @shared/constants/limits sabitini kullan.`,
          ]
        : [],
    );
}

function main() {
  const root = resolve(import.meta.dirname, '..');
  const files = collectStyleSources(join(root, 'src'));
  const violations = files.flatMap(file => {
    const relativePath = file.slice(root.length + 1).replaceAll('\\', '/');
    const source = readFileSync(file, 'utf8');
    return [
      ...findColorLiterals(source, relativePath),
      ...findPageSizeLiterals(source, relativePath),
    ];
  });

  if (violations.length > 0) {
    console.error('Hardcode guard hataları:');
    violations.forEach(violation => console.error(`- ${violation}`));
    process.exit(1);
  }

  console.log(
    `Hardcode guardı geçti: ${files.length} kaynak dosyasında ham renk veya sayfa boyutu değeri yok.`,
  );
}

const invokedDirectly =
  process.argv[1]?.endsWith('check-hardcoded-values.mjs') ?? false;
if (invokedDirectly) main();

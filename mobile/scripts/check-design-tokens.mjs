import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Design-token contract for the existing screens.
//
// The product has one theme. Every colour a screen paints must come from
// `src/shared/theme/tokens.ts` so that contrast, the dark media surfaces and
// the glass controls stay consistent, and so a colour change is a one-file
// change. Literal colours drift silently: this repository had two different
// near-black media canvases and four different white glass alphas for the same
// visual role, plus two verbatim copies of the `overlay` token.
//
// The theme module itself is the one place literals are allowed.

const THEME_MODULE = 'src/shared/theme/tokens.ts';

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

function main() {
  const root = resolve(import.meta.dirname, '..');
  const files = collectStyleSources(join(root, 'src'));
  const violations = files.flatMap(file => {
    const relativePath = file.slice(root.length + 1).replaceAll('\\', '/');
    return findColorLiterals(readFileSync(file, 'utf8'), relativePath);
  });

  if (violations.length > 0) {
    console.error('Tasarım tokenı guard hataları:');
    violations.forEach(violation => console.error(`- ${violation}`));
    process.exit(1);
  }

  console.log(
    `Tasarım tokenı guardı geçti: ${files.length} kaynak dosyasında ham renk değeri yok.`,
  );
}

const invokedDirectly =
  process.argv[1]?.endsWith('check-design-tokens.mjs') ?? false;
if (invokedDirectly) main();

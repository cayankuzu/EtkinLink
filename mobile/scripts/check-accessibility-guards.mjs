import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Screen-reader contract for the existing screens.
//
// React Native's `Pressable` and the `Touchable*` family default to
// `accessible={true}`. On iOS that turns the element into a single VoiceOver
// node and hides every control nested inside it, so a bottom sheet or a slider
// track wrapped in a Pressable silently becomes unusable with VoiceOver even
// though it looks correct on screen. This guard keeps that regression, and
// unlabelled icon-only controls, out of the tree.
//
// The contract per touchable is:
//   - it is an accessibility element with an explicit `accessibilityRole`, and
//     it exposes a name (an `accessibilityLabel` or readable text children); or
//   - it is explicitly `accessible={false}`, i.e. a layout/tap-blocking wrapper
//     whose children carry the semantics.

const TOUCHABLE_COMPONENTS = [
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'Pressable',
];

const TEXT_COMPONENTS = ['AppText', 'Text'];

export function collectScreenFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectScreenFiles(path);
    if (!/\.tsx$/u.test(entry.name)) return [];
    if (/\.test\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

function findOpeningTagEnd(source, fromIndex) {
  let index = fromIndex;
  let braceDepth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (character === '>' && braceDepth === 0) {
      return { end: index, selfClosing: source[index - 1] === '/' };
    }
    index += 1;
  }
  return { end: source.length - 1, selfClosing: false };
}

function findChildren(source, component, openingTagEnd) {
  const boundary = new RegExp(`<(/?)${component}\\b`, 'gu');
  boundary.lastIndex = openingTagEnd + 1;
  let nesting = 1;
  let match;
  while ((match = boundary.exec(source))) {
    nesting += match[1] === '/' ? -1 : 1;
    if (nesting === 0) return source.slice(openingTagEnd + 1, match.index);
  }
  return source.slice(openingTagEnd + 1);
}

export function findAccessibilityViolations(source, relativePath) {
  const violations = [];
  const opening = new RegExp(`<(${TOUCHABLE_COMPONENTS.join('|')})\\b`, 'gu');
  let match;

  while ((match = opening.exec(source))) {
    const component = match[1];
    const { end, selfClosing } = findOpeningTagEnd(source, opening.lastIndex);
    const tag = source.slice(match.index, end + 1);
    const line = source.slice(0, match.index).split('\n').length;
    const location = `${relativePath}:${line} <${component}>`;

    // An explicit opt-out is the sanctioned way to write a wrapper whose
    // children carry the semantics.
    if (/accessible=\{false\}/u.test(tag)) continue;

    if (!/accessibilityRole=/u.test(tag)) {
      violations.push(
        `${location}: accessibilityRole eksik; kontrol değilse accessible={false} kullan.`,
      );
    }

    if (/accessibilityLabel=/u.test(tag)) continue;

    const children = selfClosing ? '' : findChildren(source, component, end);
    const namedByChildren = new RegExp(
      `<(${TEXT_COMPONENTS.join('|')})\\b`,
      'u',
    ).test(children);
    if (!namedByChildren) {
      violations.push(
        `${location}: ekran okuyucu adı yok; accessibilityLabel ekle veya accessible={false} kullan.`,
      );
    }
  }

  return violations;
}

function main() {
  const root = resolve(import.meta.dirname, '..');
  const sourceRoot = join(root, 'src');
  const files = collectScreenFiles(sourceRoot);
  const violations = files.flatMap(file =>
    findAccessibilityViolations(
      readFileSync(file, 'utf8'),
      file.slice(root.length + 1).replaceAll('\\', '/'),
    ),
  );

  if (violations.length > 0) {
    console.error('Erişilebilirlik guard hataları:');
    violations.forEach(violation => console.error(`- ${violation}`));
    process.exit(1);
  }

  console.log(
    `Erişilebilirlik guardı geçti: ${files.length} ekran dosyasındaki dokunma hedefleri rol ve ada sahip.`,
  );
}

if (process.argv[1] && import.meta.url.endsWith('check-accessibility-guards.mjs')) {
  const invokedDirectly = process.argv[1].endsWith(
    'check-accessibility-guards.mjs',
  );
  if (invokedDirectly) main();
}

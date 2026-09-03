import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findColorLiterals,
  findPageSizeLiterals,
} from './check-hardcoded-values.mjs';

test('token referansı kabul edilir', () => {
  const source = "const styles = { card: { backgroundColor: colors.surface } };";
  assert.deepEqual(findColorLiterals(source, 'src/A.tsx'), []);
});

test('hex renk reddedilir', () => {
  const violations = findColorLiterals(
    "  backgroundColor: '#050505',",
    'src/B.tsx',
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^src\/B\.tsx:1/u);
  assert.match(violations[0], /@shared\/theme tokenı kullan/u);
});

test('kısa hex ve alfa kanallı hex de yakalanır', () => {
  assert.equal(findColorLiterals("color: '#fff',", 'src/C.tsx').length, 1);
  assert.equal(findColorLiterals("color: '#10182880',", 'src/D.tsx').length, 1);
});

test('rgb, rgba, hsl ve hsla yakalanır', () => {
  const source = [
    "a: 'rgb(1, 2, 3)',",
    "b: 'rgba(1, 2, 3, 0.4)',",
    "c: 'hsl(1, 2%, 3%)',",
    "d: 'hsla(1, 2%, 3%, 0.4)',",
  ].join('\n');
  assert.equal(findColorLiterals(source, 'src/E.tsx').length, 4);
});

test('boşluklu rgba çağrısı da yakalanır', () => {
  assert.equal(
    findColorLiterals("shadow: 'rgba (0, 0, 0, 0.2)',", 'src/F.tsx').length,
    1,
  );
});

test('tema modülü tek istisnadır', () => {
  const source = "export const colors = { canvas: '#F7F8FC' } as const;";
  assert.deepEqual(
    findColorLiterals(source, 'src/shared/theme/tokens.ts'),
    [],
  );
  assert.equal(findColorLiterals(source, 'src/shared/theme/other.ts').length, 1);
});

test('renk olmayan diyez ve kimlikler yanlış pozitif üretmez', () => {
  const source = [
    "const anchor = 'section-1';",
    'const id = `${prefix}-abc`;',
    "const hint = 'Sohbet #1';",
  ].join('\n');
  assert.deepEqual(findColorLiterals(source, 'src/G.tsx'), []);
});

test('sayfa boyutu literali reddedilir', () => {
  const violations = findPageSizeLiterals('    .limit(35);', 'src/A.ts');
  assert.equal(violations.length, 1);
  assert.match(violations[0], /@shared\/constants\/limits sabitini kullan/u);
});

test('page_size ve pageSize anahtarları da yakalanır', () => {
  const source = ['      page_size: 35,', '      pageSize: 20,'].join('\n');
  assert.equal(findPageSizeLiterals(source, 'src/B.ts').length, 2);
});

test('sabit referansı kabul edilir', () => {
  const source = [
    '    .limit(paginationLimits.thread);',
    '      page_size: paginationLimits.rooms,',
  ].join('\n');
  assert.deepEqual(findPageSizeLiterals(source, 'src/C.ts'), []);
});

test('limits modülü tek istisnadır', () => {
  const source = '  thread: 35,';
  assert.deepEqual(
    findPageSizeLiterals(source, 'src/shared/constants/limits.ts'),
    [],
  );
});

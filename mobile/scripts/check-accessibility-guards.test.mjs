import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findAccessibilityViolations } from './check-accessibility-guards.mjs';

test('etiketli ve rollü dokunma hedefi kabul edilir', () => {
  const source = `
    <Pressable accessibilityRole="button" accessibilityLabel="Kapat" onPress={close} />
  `;
  assert.deepEqual(findAccessibilityViolations(source, 'src/A.tsx'), []);
});

test('metin çocuğu ekran okuyucu adı sağlar', () => {
  const source = `
    <Pressable accessibilityRole="button" onPress={submit}>
      <AppText>Giriş Yap</AppText>
    </Pressable>
  `;
  assert.deepEqual(findAccessibilityViolations(source, 'src/B.tsx'), []);
});

test('ikon-only kontrol adsız bırakılamaz', () => {
  const source = `
    <Pressable accessibilityRole="button" onPress={close}>
      <X size={20} />
    </Pressable>
  `;
  const violations = findAccessibilityViolations(source, 'src/C.tsx');
  assert.equal(violations.length, 1);
  assert.match(violations[0], /ekran okuyucu adı yok/u);
  assert.match(violations[0], /^src\/C\.tsx:2 <Pressable>/u);
});

test('rolsüz dokunma hedefi reddedilir', () => {
  const source = `
    <Pressable onPress={close}>
      <AppText>Kapat</AppText>
    </Pressable>
  `;
  const violations = findAccessibilityViolations(source, 'src/D.tsx');
  assert.equal(violations.length, 1);
  assert.match(violations[0], /accessibilityRole eksik/u);
});

test('accessible={false} sarmalayıcı kontrol sayılmaz', () => {
  const source = `
    <Pressable accessible={false} onPress={blockBackdropTap} style={sheet}>
      <OptionRow />
    </Pressable>
  `;
  assert.deepEqual(findAccessibilityViolations(source, 'src/E.tsx'), []);
});

test('JSX ifadesi içindeki > açılış etiketini erken bitirmez', () => {
  const source = `
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? 'Devam' : 'Başla'}
      onPress={next}
    />
  `;
  assert.deepEqual(findAccessibilityViolations(source, 'src/F.tsx'), []);
});

test('iç içe aynı bileşen doğru kapanışla eşlenir', () => {
  const source = `
    <Pressable accessible={false} onPress={outer}>
      <Pressable accessibilityRole="button" onPress={inner}>
        <AppText>İç</AppText>
      </Pressable>
    </Pressable>
  `;
  assert.deepEqual(findAccessibilityViolations(source, 'src/G.tsx'), []);
});

test('her dokunma bileşeni ailesi taranır', () => {
  const source = `
    <TouchableOpacity onPress={a} />
    <TouchableHighlight onPress={b} />
    <TouchableWithoutFeedback onPress={c} />
  `;
  const violations = findAccessibilityViolations(source, 'src/H.tsx');
  // Each one is missing both a role and a name.
  assert.equal(violations.length, 6);
});

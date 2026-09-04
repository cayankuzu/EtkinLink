import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectStyleSizes,
  findTouchTargetViolations,
  readHitSlop,
  readSharedControlBase,
} from './check-touch-targets.mjs';

const layoutTokens = {
  minimumTouchTarget: 48,
  compactTouchTarget: 44,
  controlHeight: 44,
};

test('collectStyleSizes resolves literals and layout tokens, skips computed values', () => {
  const sizes = collectStyleSizes(
    `const styles = StyleSheet.create({
      literal: { width: 36, height: 36 },
      token: { minHeight: layout.compactTouchTarget },
      computed: { height: rowHeight * 2 },
      unsized: { flexDirection: 'row' },
    });`,
    layoutTokens,
  );

  assert.deepEqual(sizes.get('literal'), { width: 36, height: 36 });
  assert.deepEqual(sizes.get('token'), { width: null, height: 44 });
  assert.equal(sizes.has('computed'), false);
  assert.equal(sizes.has('unsized'), false);
});

test('readHitSlop reads both forms and resolves the sanctioned helper', () => {
  const sizes = collectStyleSizes(
    'const styles = StyleSheet.create({ save: { height: 36 } });',
    layoutTokens,
  );

  assert.equal(readHitSlop('<Pressable hitSlop={8} />'), 8);
  // The smallest edge is what limits the reachable area.
  assert.equal(readHitSlop('<Pressable hitSlop={{ top: 3, bottom: 9 }} />'), 3);
  assert.equal(readHitSlop('<Pressable />'), 0);
  assert.equal(
    readHitSlop('<Pressable hitSlop={touchSlopFor(styles.save.height)} />', sizes),
    6,
  );
});

test('a control below the floor is reported with its effective area', () => {
  const violations = findTouchTargetViolations(
    `<Pressable accessibilityRole="button" onPress={x} style={styles.remove} />
     const styles = StyleSheet.create({ remove: { width: 40, height: 40 } });`,
    'src/example.tsx',
    layoutTokens,
  );

  assert.equal(violations.length, 2);
  assert.match(violations[0], /40dp kutu \+ 2x0dp hitSlop/u);
  assert.match(violations[0], /en az 48dp/u);
});

test('the helper closes the gap without changing the drawn size', () => {
  const violations = findTouchTargetViolations(
    `<Pressable
       accessibilityRole="button"
       onPress={x}
       hitSlop={touchSlopFor(styles.remove.height)}
       style={styles.remove}
     />
     const styles = StyleSheet.create({ remove: { width: 40, height: 40 } });`,
    'src/example.tsx',
    layoutTokens,
  );

  assert.deepEqual(violations, []);
});

test('a shared control contributes its own size and slop', () => {
  const iconButton = `const styles = StyleSheet.create({
      base: { width: layout.compactTouchTarget, height: layout.compactTouchTarget },
    });
    <Pressable hitSlop={8} />`;
  const base = readSharedControlBase(iconButton, layoutTokens);
  assert.deepEqual(base, { slop: 8, width: 44, height: 44 });

  // 44 + 2x8 clears the floor, so a plain usage is not a violation...
  assert.deepEqual(
    findTouchTargetViolations(
      '<IconButton icon={X} label="a" onPress={y} />',
      'src/example.tsx',
      layoutTokens,
      { IconButton: base },
    ),
    [],
  );
  // ...but a style override that shrinks it below the floor still is.
  const shrunk = findTouchTargetViolations(
    `<IconButton icon={X} label="a" onPress={y} style={styles.tiny} />
     const styles = StyleSheet.create({ tiny: { width: 24, height: 24 } });`,
    'src/example.tsx',
    layoutTokens,
    { IconButton: base },
  );
  assert.equal(shrunk.length, 2);
  assert.match(shrunk[0], /24dp kutu \+ 2x8dp hitSlop/u);
});

test('a wrapper that opts out of the accessibility tree is not a control', () => {
  assert.deepEqual(
    findTouchTargetViolations(
      `<Pressable accessible={false} style={styles.overlay} />
       const styles = StyleSheet.create({ overlay: { width: 12, height: 12 } });`,
      'src/example.tsx',
      layoutTokens,
    ),
    [],
  );
});

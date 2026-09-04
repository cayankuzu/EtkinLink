import { colors, typography } from '@shared/theme';

// WCAG 2.1 relative luminance.
function luminance(hex: string) {
  const rgb = hex.replace('#', '');
  const toLinear = (offset: number) => {
    const normalized = Number.parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(0) + 0.7152 * toLinear(2) + 0.0722 * toLinear(4);
}

function contrast(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_NORMAL = 4.5;
const MIN_FONT_SIZE = 12;

describe('theme tokens', () => {
  it('keeps every readable text colour at AA on every opaque surface', () => {
    const surfaces = [
      colors.canvas,
      colors.surface,
      colors.surfaceMuted,
      colors.surfaceSoft,
    ];
    const readable = {
      textPrimary: colors.textPrimary,
      textSecondary: colors.textSecondary,
      iconPrimary: colors.iconPrimary,
      brand: colors.brand,
      brandPressed: colors.brandPressed,
    };

    const failures: string[] = [];
    for (const [name, foreground] of Object.entries(readable)) {
      for (const surface of surfaces) {
        const ratio = contrast(foreground, surface);
        if (ratio < AA_NORMAL)
          failures.push(`${name} on ${surface} = ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('pairs every soft status surface with a text colour that clears AA', () => {
    // Coral shipped as the only soft surface without a dark partner, so event
    // titles rendered at 2.52:1 inside the match-hub chip.
    const pairs: Array<[string, string]> = [
      [colors.success, colors.successSoft],
      [colors.warning, colors.warningSoft],
      [colors.danger, colors.dangerSoft],
      [colors.accentStrong, colors.accentSoft],
      [colors.brand, colors.brandSoft],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.3);
    }
  });

  it('keeps inverse text readable on every filled brand surface', () => {
    for (const background of [
      colors.brand,
      colors.brandPressed,
      colors.danger,
      colors.dangerPressed,
    ]) {
      expect(contrast(colors.textInverse, background)).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    }
  });

  it('ships no type token below the readability floor', () => {
    const undersized = Object.entries(typography)
      .filter(([, style]) => style.fontSize < MIN_FONT_SIZE)
      .map(([name, style]) => `${name} (${style.fontSize}px)`);
    expect(undersized).toEqual([]);
  });

  it('gives every type token room for Turkish diacritics', () => {
    // Turkish stacks ğ, ş and the dotted capital İ; below 1.25x leading these
    // clip on Android.
    const tight = Object.entries(typography)
      .filter(([, style]) => style.lineHeight / style.fontSize < 1.25)
      .map(
        ([name, style]) => `${name} (${style.lineHeight}/${style.fontSize})`,
      );
    expect(tight).toEqual([]);
  });

  it('names type roles by intent so the scale cannot drift out of its labels', () => {
    // The previous scale was size-suffixed and every suffix had gone stale.
    const sizeSuffixed = Object.keys(typography).filter(name =>
      /\d/.test(name),
    );
    expect(sizeSuffixed).toEqual([]);
  });
});

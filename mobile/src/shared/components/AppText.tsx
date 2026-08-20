import { colors, typography } from '@shared/theme';
import type { PropsWithChildren } from 'react';
import type { TextProps, TextStyle } from 'react-native';
import { Text } from 'react-native';

type TextVariant = keyof typeof typography;
type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'inverse'
  | 'brand'
  | 'danger'
  | 'success';

type AppTextProps = PropsWithChildren<
  TextProps & {
    variant?: TextVariant;
    tone?: TextTone;
    align?: TextStyle['textAlign'];
  }
>;

const tones: Record<TextTone, string> = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  inverse: colors.textInverse,
  brand: colors.brand,
  danger: colors.danger,
  success: colors.success,
};

export function AppText({
  variant = 'body15',
  tone = 'primary',
  align,
  style,
  maxFontSizeMultiplier = 2,
  children,
  ...props
}: AppTextProps) {
  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        typography[variant],
        { color: tones[tone], textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}

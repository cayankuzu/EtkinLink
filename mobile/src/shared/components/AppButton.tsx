import { colors, layout, radius, spacing } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import type { ComponentType } from 'react';
import type { PressableProps, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type AppButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ComponentType<LucideProps>;
  style?: ViewStyle;
};

const backgrounds: Record<ButtonVariant, string> = {
  primary: colors.brand,
  secondary: colors.surface,
  ghost: colors.transparent,
  danger: colors.danger,
};

export function AppButton({
  label,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  disabled,
  icon: Icon,
  style,
  accessibilityLabel = label,
  ...props
}: AppButtonProps) {
  const inverse = variant === 'primary' || variant === 'danger';
  const contentColor = inverse
    ? colors.textInverse
    : variant === 'secondary'
    ? colors.textPrimary
    : colors.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: backgrounds[variant] },
        variant === 'secondary' && styles.secondary,
        fullWidth && styles.fullWidth,
        pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={inverse ? colors.textInverse : colors.brand}
        />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={20} color={contentColor} /> : null}
          <AppText
            variant="label15"
            tone={
              inverse
                ? 'inverse'
                : variant === 'secondary'
                ? 'primary'
                : 'brand'
            }
          >
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  secondary: { borderWidth: 1.5, borderColor: colors.border },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});

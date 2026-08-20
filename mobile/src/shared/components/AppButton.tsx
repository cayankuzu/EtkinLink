import { colors, layout, radius, spacing } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useCallback, useRef, useState } from 'react';
import type {
  GestureResponderEvent,
  PressableProps,
  ViewStyle,
} from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { triggerHaptic } from '../lib/haptics';
import { AppText } from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type AppButtonProps = Omit<PressableProps, 'children' | 'onPress' | 'style'> & {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: ComponentType<LucideProps>;
  style?: ViewStyle;
  onPress?: (event: GestureResponderEvent) => void | Promise<void>;
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
  onPress,
  ...props
}: AppButtonProps) {
  const [internallyBusy, setInternallyBusy] = useState(false);
  const lastPressAt = useRef(0);
  const busy = loading || internallyBusy;
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      if (disabled || busy || now - lastPressAt.current < 650) return;
      lastPressAt.current = now;
      triggerHaptic(variant === 'danger' ? 'warning' : 'light');
      const result = onPress?.(event);
      if (
        result &&
        typeof (result as Promise<unknown>).finally === 'function'
      ) {
        setInternallyBusy(true);
        void (result as Promise<unknown>).finally(() =>
          setInternallyBusy(false),
        );
      }
    },
    [busy, disabled, onPress, variant],
  );
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
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      hitSlop={6}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: backgrounds[variant] },
        variant === 'secondary' && styles.secondary,
        fullWidth && styles.fullWidth,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
        style,
      ]}
      {...props}
    >
      {busy ? (
        <ActivityIndicator
          color={inverse ? colors.textInverse : colors.brand}
        />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon size={18} color={contentColor} /> : null}
          <AppText
            variant="label15"
            align="center"
            style={styles.label}
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
    minHeight: layout.controlHeight,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxs,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 1,
    gap: spacing.xs,
  },
  label: { flexShrink: 1 },
  secondary: { borderWidth: 1.5, borderColor: colors.border },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});

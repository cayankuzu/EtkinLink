import { colors, layout, radius } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useCallback, useRef } from 'react';
import type {
  GestureResponderEvent,
  PressableProps,
  ViewStyle,
} from 'react-native';
import { Pressable, StyleSheet } from 'react-native';

import { triggerHaptic } from '../lib/haptics';

type IconButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: ComponentType<LucideProps>;
  label: string;
  selected?: boolean;
  danger?: boolean;
  style?: ViewStyle;
};

export function IconButton({
  icon: Icon,
  label,
  selected = false,
  danger = false,
  style,
  onPress,
  ...props
}: IconButtonProps) {
  const lastPressAt = useRef(0);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      if (now - lastPressAt.current < 350) return;
      lastPressAt.current = now;
      triggerHaptic(danger ? 'warning' : 'selection');
      onPress?.(event);
    },
    [danger, onPress],
  );
  const color = danger
    ? colors.danger
    : selected
    ? colors.textInverse
    : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={8}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        selected && styles.selected,
        pressed && styles.pressed,
        style,
      ]}
      {...props}
    >
      <Icon size={20} color={color} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: layout.compactTouchTarget,
    height: layout.compactTouchTarget,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.brand, borderColor: colors.brand },
  pressed: { opacity: 0.7 },
});

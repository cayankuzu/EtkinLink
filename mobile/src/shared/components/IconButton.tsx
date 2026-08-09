import { colors, layout, radius } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import type { ComponentType } from 'react';
import type { PressableProps, ViewStyle } from 'react-native';
import { Pressable, StyleSheet } from 'react-native';

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
  ...props
}: IconButtonProps) {
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
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        selected && styles.selected,
        pressed && styles.pressed,
        style,
      ]}
      {...props}
    >
      <Icon size={22} color={color} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: layout.touchTarget,
    height: layout.touchTarget,
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

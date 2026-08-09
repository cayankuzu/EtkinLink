import { AppText } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  label: string;
  description?: string;
  selected: boolean;
  disabled?: boolean;
  role?: 'checkbox' | 'radio';
  onPress: () => void;
};

export function CheckSelectionRow({
  label,
  description,
  selected,
  disabled = false,
  role = 'checkbox',
  onPress,
}: Props) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        disabled ? styles.rowDisabled : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.copy}>
        <AppText variant="label14" tone={disabled ? 'secondary' : 'primary'}>
          {label}
        </AppText>
        {description ? (
          <AppText variant="caption12" tone="secondary">
            {description}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.check, selected ? styles.checkSelected : null]}>
        {selected ? <Check size={16} color={colors.textInverse} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  rowDisabled: { opacity: 0.62 },
  rowPressed: { opacity: 0.76 },
  copy: { flex: 1, gap: 2 },
  check: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  checkSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
});

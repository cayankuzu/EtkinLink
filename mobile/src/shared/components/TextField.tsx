import { colors, layout, radius, spacing, typography } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { forwardRef, useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from './AppText';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  showCounter?: boolean;
  leadingIcon?: ComponentType<LucideProps>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextFieldComponent(
    {
      label,
      error,
      hint,
      value,
      maxLength,
      showCounter = Boolean(maxLength),
      secureTextEntry,
      editable,
      leadingIcon: LeadingIcon,
      onFocus,
      onBlur,
      style,
      ...props
    },
    ref,
  ) {
    const [hidden, setHidden] = useState(Boolean(secureTextEntry));
    const [focused, setFocused] = useState(false);
    const disabled = editable === false;
    const iconColor = error
      ? colors.danger
      : focused
      ? colors.brand
      : colors.textTertiary;

    return (
      <View style={styles.wrapper}>
        <View style={styles.labelRow}>
          <AppText variant="label14">{label}</AppText>
          {showCounter && maxLength ? (
            <AppText variant="caption12" tone="tertiary">
              {value?.length ?? 0}/{maxLength}
            </AppText>
          ) : null}
        </View>
        <View
          style={[
            styles.field,
            focused ? styles.fieldFocused : null,
            error ? styles.fieldError : null,
            disabled ? styles.fieldDisabled : null,
          ]}
        >
          {LeadingIcon ? (
            <View style={styles.leadingIcon} pointerEvents="none">
              <LeadingIcon size={20} color={iconColor} strokeWidth={2} />
            </View>
          ) : null}
          <TextInput
            ref={ref}
            value={value}
            editable={editable}
            maxLength={maxLength}
            secureTextEntry={secureTextEntry ? hidden : false}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.brand}
            accessibilityLabel={label}
            accessibilityHint={hint}
            onFocus={event => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={event => {
              setFocused(false);
              onBlur?.(event);
            }}
            style={[
              styles.input,
              LeadingIcon ? styles.inputWithLeadingIcon : null,
              secureTextEntry ? styles.inputWithAction : null,
              disabled ? styles.inputDisabled : null,
              style,
            ]}
            {...props}
          />
          {secureTextEntry ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hidden ? 'Şifreyi göster' : 'Şifreyi gizle'}
              hitSlop={8}
              onPress={() => setHidden(current => !current)}
              style={styles.action}
            >
              {hidden ? (
                <Eye size={20} color={colors.textSecondary} />
              ) : (
                <EyeOff size={20} color={colors.textSecondary} />
              )}
            </Pressable>
          ) : null}
        </View>
        {error || hint ? (
          <View style={styles.meta}>
            <AppText
              variant="caption12"
              tone={error ? 'danger' : 'tertiary'}
              style={styles.metaText}
            >
              {error || hint}
            </AppText>
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  field: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  fieldFocused: {
    borderWidth: 1.5,
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  fieldError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  fieldDisabled: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  input: {
    ...typography.body16,
    color: colors.textPrimary,
    minHeight: layout.touchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputWithLeadingIcon: { paddingLeft: 48 },
  inputWithAction: { paddingRight: 52 },
  inputDisabled: { color: colors.textSecondary },
  leadingIcon: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 1,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    position: 'absolute',
    right: 4,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    minHeight: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  metaText: { flex: 1 },
});

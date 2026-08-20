import { contentLimits } from '@shared/constants/limits';
import { colors, radius, spacing, typography } from '@shared/theme';
import { Send, Smile } from 'lucide-react-native';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export function ChatComposer({
  accessibilityLabel,
  value,
  onChangeText,
  onBlur,
  onSend,
  onAddEmoji,
}: {
  accessibilityLabel: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur: () => void;
  onSend: () => void;
  onAddEmoji?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={accessibilityLabel}
          placeholder="Mesaj yaz..."
          placeholderTextColor={colors.textTertiary}
          value={value}
          maxLength={contentLimits.message}
          multiline
          onChangeText={onChangeText}
          onBlur={onBlur}
          style={styles.input}
        />
        {onAddEmoji ? (
          <IconButton
            icon={Smile}
            label="Gülümseme ekle"
            onPress={onAddEmoji}
            style={styles.action}
          />
        ) : null}
        <IconButton
          icon={Send}
          label="Mesajı gönder"
          selected
          disabled={!value.trim()}
          onPress={onSend}
        />
      </View>
      <AppText variant="tiny11" tone="tertiary" align="right">
        {value.length}/{contentLimits.message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 4,
    backgroundColor: colors.surface,
  },
  composer: {
    minHeight: 48,
    maxHeight: 112,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: spacing.sm,
    paddingRight: 4,
    paddingVertical: 4,
  },
  input: {
    ...typography.body15,
    color: colors.textPrimary,
    flex: 1,
    maxHeight: 96,
    paddingVertical: spacing.xs,
  },
  action: { backgroundColor: colors.transparent },
});

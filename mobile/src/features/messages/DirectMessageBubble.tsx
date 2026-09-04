import { AppImage, AppText } from '@shared/components';
import { formatMessageDateTime } from '@shared/lib/date';
import { colors, radius, spacing } from '@shared/theme';
import type { DirectMessage } from '@shared/types/domain';
import { Check, CheckCheck, Clock3, RotateCcw } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  message: DirectMessage;
  mine: boolean;
  otherPhotoUrl: string | null;
  onFailed: () => void;
};

export function DirectMessageBubble({
  message,
  mine,
  otherPhotoUrl,
  onFailed,
}: Props) {
  const failed = message.status === 'failed';
  return (
    <Pressable
      disabled={!failed}
      onPress={onFailed}
      style={[styles.messageRow, mine && styles.messageRowMine]}
      accessibilityRole={failed ? 'button' : undefined}
      accessibilityLabel={
        failed ? 'Başarısız mesaj. Yeniden göndermek için dokun' : undefined
      }
    >
      {!mine ? (
        otherPhotoUrl ? (
          <AppImage
            uri={otherPhotoUrl}
            accessibilityLabel="Mesaj gönderenin profil fotoğrafı"
            style={styles.messageAvatar}
          />
        ) : (
          <View style={styles.messageAvatar} />
        )
      ) : null}
      <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleOther,
            failed && styles.bubbleFailed,
          ]}
        >
          <AppText variant="body" tone={mine ? 'inverse' : 'primary'}>
            {message.body}
          </AppText>
        </View>
        <View style={[styles.status, mine && styles.statusMine]}>
          {message.status === 'sending' && mine ? (
            <Clock3 size={12} color={colors.textTertiary} />
          ) : failed ? (
            <RotateCcw size={12} color={colors.danger} />
          ) : message.status === 'read' && mine ? (
            <CheckCheck size={14} color={colors.brand} />
          ) : mine ? (
            <Check size={13} color={colors.textTertiary} />
          ) : null}
          <AppText variant="caption" tone="tertiary">
            {message.status === 'sending'
              ? `Gönderiliyor · ${formatMessageDateTime(message.createdAt)}`
              : failed
              ? `Başarısız · ${formatMessageDateTime(message.createdAt)}`
              : message.status === 'read' && mine
              ? `Okundu · ${formatMessageDateTime(message.createdAt)}`
              : mine
              ? `Gönderildi · ${formatMessageDateTime(message.createdAt)}`
              : formatMessageDateTime(message.createdAt)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
  },
  messageRowMine: { justifyContent: 'flex-end' },
  messageAvatar: {
    width: 28,
    height: 28,
    marginRight: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  messageColumn: { maxWidth: '78%', alignItems: 'flex-start' },
  messageColumnMine: { alignItems: 'flex-end' },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleFailed: { backgroundColor: colors.danger },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
  },
  statusMine: { alignSelf: 'flex-end' },
});

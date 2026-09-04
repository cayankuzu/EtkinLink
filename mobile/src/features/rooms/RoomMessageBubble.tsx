import { AppImage, AppText } from '@shared/components';
import { formatMessageDateTime } from '@shared/lib/date';
import { colors, radius, spacing } from '@shared/theme';
import type { RoomMessage } from '@shared/types/domain';
import { RotateCcw } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

type Props = {
  message: RoomMessage;
  mine: boolean;
  onFailed: () => void;
};

export function RoomMessageBubble({ message, mine, onFailed }: Props) {
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
        message.senderPhotoUrl ? (
          <AppImage
            uri={message.senderPhotoUrl}
            accessibilityLabel={`${message.senderName} profil fotoğrafı`}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarFallback} />
        )
      ) : null}
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleOther,
          failed && styles.bubbleFailed,
        ]}
      >
        {!mine ? (
          <AppText variant="caption" tone="brand">
            {message.senderName}
          </AppText>
        ) : null}
        <AppText variant="body" tone={mine ? 'inverse' : 'primary'}>
          {message.body}
        </AppText>
        <View style={styles.messageStatus}>
          {failed ? (
            <RotateCcw
              size={12}
              color={mine ? colors.textInverse : colors.danger}
            />
          ) : null}
          <AppText variant="caption" tone={mine ? 'inverse' : 'tertiary'}>
            {message.status === 'sending'
              ? `Gönderiliyor · ${formatMessageDateTime(message.createdAt)}`
              : failed
              ? `Başarısız · ${formatMessageDateTime(message.createdAt)}`
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
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  messageRowMine: { justifyContent: 'flex-end' },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  avatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleFailed: { backgroundColor: colors.danger },
  messageStatus: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
});

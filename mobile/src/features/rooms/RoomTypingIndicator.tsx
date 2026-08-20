import { AppImage, AppText } from '@shared/components';
import { colors, spacing } from '@shared/theme';
import { StyleSheet, View } from 'react-native';

import type { RoomParticipant } from './roomParticipantsService';

export function RoomTypingIndicator({
  participants,
}: {
  participants: RoomParticipant[];
}) {
  const visible = participants.slice(0, 4);
  const names = visible.map(participant => participant.fullName);
  const label =
    names.length === 1
      ? `${names[0]} yazıyor...`
      : names.length === 2
      ? `${names[0]} ve ${names[1]} yazıyor...`
      : `${names.slice(0, -1).join(', ')} ve ${names.at(-1)} yazıyor...`;

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <View style={styles.avatars} accessibilityElementsHidden>
        {visible.map((participant, index) =>
          participant.photoUrl ? (
            <AppImage
              key={participant.id}
              uri={participant.photoUrl}
              style={[styles.avatar, index > 0 && styles.avatarOverlap]}
            />
          ) : (
            <View
              key={participant.id}
              style={[
                styles.avatar,
                styles.avatarFallback,
                index > 0 && styles.avatarOverlap,
              ]}
            >
              <AppText variant="tiny11" tone="brand">
                {participant.fullName
                  .trim()
                  .charAt(0)
                  .toLocaleUpperCase('tr-TR')}
              </AppText>
            </View>
          ),
        )}
      </View>
      <AppText variant="caption12" tone="success" numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarOverlap: { marginLeft: -8 },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
});

import { AppImage, AppText } from '@shared/components';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type { Event } from '@shared/types/domain';
import { Bookmark, MapPin, UsersRound } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventImage } from './EventImage';
import { inferEventCity } from './rssEventService';

type EventCardProps = {
  event: Event;
  type?: 'standard' | 'joined';
  onPress: () => void;
  onToggleSaved?: () => void;
};

function formatCardDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} · ${time}`;
}

export function EventCard({
  event,
  type = 'standard',
  onPress,
  onToggleSaved,
}: EventCardProps) {
  const city = inferEventCity(event) ?? event.district?.trim() ?? 'Türkiye';
  const attendeePhotoUrls = event.attendeePhotoUrls ?? [];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title} etkinliğini aç`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.imageWrap}>
        <EventImage imageUrl={event.imageUrl} style={styles.image} />
      </View>

      <View style={styles.content}>
        <View style={styles.topMeta}>
          <View style={styles.categoryBadge}>
            <AppText variant="caption" tone="brand" numberOfLines={1}>
              {event.categories[0] ?? 'Etkinlik'}
            </AppText>
          </View>
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            {formatCardDate(event.startAt)}
          </AppText>
        </View>

        <AppText variant="labelSm" numberOfLines={2}>
          {event.title}
        </AppText>

        <View style={styles.locationRow}>
          <MapPin size={13} color={colors.textTertiary} />
          <AppText
            variant="caption"
            tone="secondary"
            numberOfLines={1}
            style={styles.locationText}
          >
            {city}
          </AppText>
        </View>

        <View style={styles.footer}>
          <View style={styles.attendeeRow}>
            {attendeePhotoUrls.length > 0 ? (
              <View style={styles.avatarStack}>
                {attendeePhotoUrls.slice(0, 3).map((url, index) => (
                  <AppImage
                    key={url}
                    uri={url}
                    style={[styles.avatar, index > 0 && styles.avatarOverlap]}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.attendeeIcon}>
                <UsersRound size={13} color={colors.textSecondary} />
              </View>
            )}
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.attendeeText}
            >
              {event.attendeeCount} kişi katılıyor
            </AppText>
          </View>
          {type === 'joined' ? (
            <View style={styles.joinedBadge}>
              <AppText variant="caption" tone="success">
                Katılıyorsun
              </AppText>
            </View>
          ) : null}
          {onToggleSaved ? (
            <SaveButton event={event} onToggleSaved={onToggleSaved} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function SaveButton({
  event,
  onToggleSaved,
}: {
  event: Event;
  onToggleSaved: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        event.saved ? 'Kaydedilenlerden çıkar' : 'Etkinliği kaydet'
      }
      accessibilityState={{ selected: event.saved }}
      hitSlop={4}
      onPress={pressEvent => {
        pressEvent.stopPropagation();
        onToggleSaved();
      }}
      style={({ pressed }) => [
        styles.saveButton,
        event.saved && styles.saveButtonSelected,
        pressed && styles.actionPressed,
      ]}
    >
      <Bookmark
        size={17}
        color={event.saved ? colors.textInverse : colors.textSecondary}
        fill={event.saved ? colors.textInverse : colors.transparent}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.86 },
  actionPressed: { opacity: 0.72 },
  imageWrap: {
    width: '100%',
    aspectRatio: 2.75,
    backgroundColor: colors.surfaceMuted,
  },
  image: { width: '100%', height: '100%' },
  saveButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  content: { padding: spacing.sm, gap: 4 },
  topMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  categoryBadge: {
    maxWidth: '48%',
    borderRadius: 6,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { flex: 1 },
  footer: {
    minHeight: 28,
    marginTop: 2,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  attendeeRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  attendeeText: { flex: 1 },
  attendeeIcon: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  avatarStack: { flexDirection: 'row', alignItems: 'center', paddingLeft: 1 },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceMuted,
  },
  avatarOverlap: { marginLeft: -6 },
  joinedBadge: {
    borderRadius: 6,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
});

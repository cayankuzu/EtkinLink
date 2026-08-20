import { AppText } from '@shared/components';
import {
  formatEventDate,
  formatMessagePreviewDateTime,
} from '@shared/lib/date';
import { colors, radius, shadows, spacing } from '@shared/theme';
import { CalendarDays, LockKeyhole, MessageCircle } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventImage } from '../events/EventImage';
import { formatPostEventRemaining } from './roomRules';
import type { RoomState, RoomSummary } from './roomTypes';

const stateLabels: Record<
  RoomState,
  {
    label: string;
    description: string;
    background: string;
    tone: 'brand' | 'success' | 'secondary' | 'primary';
  }
> = {
  locked: {
    label: 'Yakında',
    description: 'Etkinlikten 13 gün önce açılır',
    background: colors.brandSoft,
    tone: 'brand',
  },
  active: {
    label: 'Aktif',
    description: 'Sohbet açık',
    background: colors.successSoft,
    tone: 'success',
  },
  postEvent: {
    label: 'Etkinlik sonrası',
    description: 'Etkinlik sonrası sohbet açık',
    background: colors.warningSoft,
    tone: 'primary',
  },
  archived: {
    label: 'Arşivlendi',
    description: 'Yalnızca okunabilir',
    background: colors.surfaceMuted,
    tone: 'secondary',
  },
};

export function RoomCard({
  room,
  now,
  onPress,
}: {
  room: RoomSummary;
  now: Date;
  onPress: () => void;
}) {
  const baseState = stateLabels[room.state];
  const state =
    room.state === 'postEvent'
      ? {
          ...baseState,
          label: formatPostEventRemaining(room.startAt, room.endAt, now),
        }
      : baseState;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${room.title} etkinlik odası, ${state.label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        room.state === 'archived' && styles.archived,
        room.state === 'locked' && styles.locked,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.thumbnail}>
        {room.imageUrl ? (
          <EventImage
            imageUrl={room.imageUrl}
            style={styles.image}
            iconSize={20}
          />
        ) : room.state === 'locked' ? (
          <LockKeyhole size={22} color={colors.textTertiary} />
        ) : (
          <CalendarDays size={22} color={colors.textTertiary} />
        )}
      </View>
      <View style={styles.info}>
        <AppText variant="label15" numberOfLines={1}>
          {room.title}
        </AppText>
        <View style={styles.eventMeta}>
          <View style={[styles.badge, { backgroundColor: state.background }]}>
            <AppText variant="caption12" tone={state.tone}>
              {state.label}
            </AppText>
          </View>
          <AppText variant="caption12" tone="secondary" numberOfLines={1}>
            {formatEventDate(room.startAt)}
          </AppText>
        </View>
        <View
          style={[
            styles.preview,
            room.lastMessage ? styles.previewWithMessage : undefined,
          ]}
        >
          <View style={styles.previewMeta}>
            <MessageCircle
              size={13}
              color={room.lastMessage ? colors.brand : colors.textTertiary}
            />
            <AppText
              variant="tiny11"
              tone={room.lastMessage ? 'brand' : 'tertiary'}
              numberOfLines={1}
              style={styles.previewDirection}
            >
              {room.lastMessage
                ? room.lastMessageIsMine
                  ? 'Giden mesaj'
                  : `${room.lastMessageSenderName ?? 'Katılımcı'} · Gelen mesaj`
                : 'Mesaj önizlemesi'}
            </AppText>
            {room.lastMessageAt ? (
              <AppText variant="tiny11" tone="tertiary">
                {formatMessagePreviewDateTime(room.lastMessageAt)}
              </AppText>
            ) : null}
          </View>
          <AppText
            variant="caption12"
            tone={room.lastMessage ? 'primary' : 'tertiary'}
            numberOfLines={1}
          >
            {room.lastMessage ?? state.description}
          </AppText>
        </View>
      </View>
      {room.unreadCount > 0 && room.state !== 'locked' ? (
        <View style={styles.unread}>
          <AppText variant="caption12" tone="inverse">
            {room.unreadCount > 99 ? '99+' : room.unreadCount}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    minHeight: 132,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  archived: { opacity: 0.7 },
  locked: { opacity: 0.78 },
  pressed: { opacity: 0.75 },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  info: { flex: 1, alignItems: 'flex-start', gap: spacing.xxs },
  eventMeta: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  preview: {
    width: '100%',
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
    gap: 2,
  },
  previewWithMessage: { backgroundColor: colors.brandSubtle },
  previewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  previewDirection: { flex: 1 },
  badge: { borderRadius: 6, paddingHorizontal: spacing.xs, paddingVertical: 3 },
  unread: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

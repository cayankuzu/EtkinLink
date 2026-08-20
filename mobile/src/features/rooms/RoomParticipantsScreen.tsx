import type { RoomsStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppImage,
  AppText,
  ErrorState,
  IconButton,
  RefreshableContent,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, radius, spacing, typography } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, UserRound } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  listRoomParticipants,
  type RoomParticipant,
} from './roomParticipantsService';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomParticipants'>;

function normalize(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function RoomParticipantsScreen({ route, navigation }: Props) {
  const [query, setQuery] = useState('');
  const participants = useQuery({
    queryKey: queryKeys.rooms.participants(route.params.eventId),
    queryFn: () => listRoomParticipants(route.params.eventId),
  });
  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return participants.data ?? [];
    return (participants.data ?? []).filter(participant =>
      normalize(
        `${participant.fullName} ${participant.username} ${participant.city} ${participant.bio}`,
      ).includes(needle),
    );
  }, [participants.data, query]);
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <View style={styles.titleRow}>
          <AppText variant="heading18">Katılımcılar</AppText>
          <View style={styles.countBadge}>
            <AppText variant="caption12" tone="brand">
              {participants.data?.length ?? 0} kişi
            </AppText>
          </View>
        </View>
      </View>
      <View style={styles.search}>
        <Search size={16} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel="Katılımcılarda ara"
          placeholder="Katılımcılarda ara..."
          placeholderTextColor={colors.textTertiary}
          value={query}
          onChangeText={setQuery}
          maxLength={60}
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>
      {participants.isLoading ? (
        <View style={styles.loading}>
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} style={styles.skeleton} />
          ))}
        </View>
      ) : participants.isError ? (
        <RefreshableContent
          refreshing={participants.isRefetching}
          onRefresh={() => void participants.refetch()}
        >
          <ErrorState
            title="Katılımcılar yüklenemedi"
            description={toAppError(participants.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void participants.refetch()}
          />
        </RefreshableContent>
      ) : filtered.length === 0 ? (
        <RefreshableContent
          refreshing={participants.isRefetching}
          onRefresh={() => void participants.refetch()}
        >
          <StateView
            title={query ? 'Katılımcı bulunamadı' : 'Henüz katılımcı yok'}
            description={
              query
                ? 'Arama ifadesini değiştirerek tekrar dene.'
                : 'Bu etkinliğe katılan kişiler burada görünür.'
            }
          />
        </RefreshableContent>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={participants.isRefetching}
              onRefresh={() => void participants.refetch()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          renderItem={({ item }) => <ParticipantRow participant={item} />}
        />
      )}
    </Screen>
  );
}

function ParticipantRow({ participant }: { participant: RoomParticipant }) {
  return (
    <View style={styles.row}>
      {participant.photoUrl ? (
        <AppImage uri={participant.photoUrl} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <UserRound size={20} color={colors.textTertiary} />
        </View>
      )}
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <AppText variant="label15" numberOfLines={1} style={styles.name}>
            {participant.fullName}
          </AppText>
          {participant.city ? (
            <View style={styles.cityBadge}>
              <AppText variant="caption12" tone="secondary" numberOfLines={1}>
                {participant.city}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="body14" tone="secondary" numberOfLines={1}>
          {participant.bio || `@${participant.username}`}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas, paddingTop: spacing.xs },
  header: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  countBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  search: {
    height: 40,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  searchInput: {
    ...typography.body14,
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: 8 },
  row: {
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flex: 1 },
  cityBadge: {
    maxWidth: 92,
    borderRadius: 6,
    backgroundColor: colors.canvas,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  loading: { paddingHorizontal: spacing.md, gap: 8 },
  skeleton: { height: 60, borderRadius: radius.md },
});

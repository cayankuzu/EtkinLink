import type { RoomsStackParamList } from '@app/navigation/types';
import { useFocusEffect, useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  RefreshableContent,
  Skeleton,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { colors, spacing } from '@shared/theme';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { RoomCard } from './RoomCard';
import { listRooms, subscribeToRoomListChanges } from './roomService';
import type { RoomSummary } from './roomTypes';

type Props = NativeStackScreenProps<RoomsStackParamList, 'Rooms'>;
type RoomSection = { title: string; data: RoomSummary[] };

export function RoomsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const listRef = useRef<SectionList<RoomSummary, RoomSection>>(null);
  useScrollToTop(listRef);
  const rooms = useInfiniteQuery({
    queryKey: ['rooms'],
    queryFn: ({ pageParam }) => listRooms(pageParam),
    initialPageParam: null as import('./roomTypes').RoomCursor | null,
    getNextPageParam: page => page.nextCursor,
  });
  const refreshRooms = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['rooms'] });
  }, [queryClient]);
  useFocusEffect(refreshRooms);
  useEffect(() => subscribeToRoomListChanges(refreshRooms), [refreshRooms]);
  const items = useMemo(
    () => rooms.data?.pages.flatMap(page => page.items) ?? [],
    [rooms.data],
  );
  const sections = useMemo<RoomSection[]>(() => {
    const active = items.filter(
      room => room.state === 'active' || room.state === 'postEvent',
    );
    const upcoming = items.filter(room => room.state === 'locked');
    const archived = items.filter(room => room.state === 'archived');
    return [
      { title: 'Aktif Odalar', data: active },
      { title: 'Yaklaşan', data: upcoming },
      { title: 'Arşiv', data: archived },
    ].filter(section => section.data.length > 0);
  }, [items]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="heading22">Odalar</AppText>
          <AppText variant="caption12" tone="secondary">
            Katıldığın etkinliklerin sohbet alanları
          </AppText>
        </View>
      </View>
      {rooms.isLoading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </View>
      ) : rooms.isError ? (
        <RefreshableContent
          refreshing={rooms.isRefetching}
          onRefresh={() => void rooms.refetch()}
        >
          <ErrorState
            title="Odalar yüklenemedi"
            description={toAppError(rooms.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void rooms.refetch()}
          />
        </RefreshableContent>
      ) : items.length === 0 ? (
        <RefreshableContent
          refreshing={rooms.isRefetching}
          onRefresh={() => void rooms.refetch()}
        >
          <StateView
            title="Henüz bir odan yok"
            description="Keşfette bir etkinliğe katıldığında etkinlik odası burada görünür."
          />
        </RefreshableContent>
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={item => item.eventId}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          renderSectionHeader={({ section }) => (
            <AppText
              variant="caption12"
              tone="secondary"
              style={styles.sectionTitle}
            >
              {section.title}
            </AppText>
          )}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <RoomCard
                room={item}
                onPress={() =>
                  navigation.navigate('RoomDetail', { eventId: item.eventId })
                }
              />
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={rooms.isRefetching && !rooms.isFetchingNextPage}
              onRefresh={() => void rooms.refetch()}
              tintColor={colors.brand}
            />
          }
          onEndReached={() => {
            if (rooms.hasNextPage && !rooms.isFetchingNextPage)
              void rooms.fetchNextPage();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    minHeight: 72,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerText: { gap: 2 },
  list: { paddingBottom: spacing.xl },
  sectionTitle: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  item: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  skeletons: { padding: spacing.md, gap: spacing.sm },
  skeleton: { height: 132 },
});

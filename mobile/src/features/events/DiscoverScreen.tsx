import type { DiscoverStackParamList } from '@app/navigation/types';
import { useSessionStore } from '@features/auth/sessionStore';
import { getProfile } from '@features/profile/profileService';
import { useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  IconButton,
  mainTabSafeAreaEdges,
  prefetchAppImages,
  RefreshableContent,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, layout, spacing } from '@shared/theme';
import type { Event } from '@shared/types/domain';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Search, SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, RefreshControl, StyleSheet, View } from 'react-native';

import { ConnectivityBanner } from './ConnectivityBanner';
import { EventCard } from './EventCard';
import {
  loadEventFeedSnapshot,
  saveEventFeedSnapshot,
} from './eventFeedSnapshot';
import { useEventFilterStore } from './eventFilterStore';
import {
  clearEventFeedCache,
  searchEventPreview,
  searchEvents,
  setEventSaved,
} from './eventService';
import type { EventPage } from './eventTypes';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'Discover'>;
const feedEndDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function DiscoverScreen({ navigation }: Props) {
  const listRef = useRef<FlashListRef<Event>>(null);
  const [refreshing, setRefreshing] = useState(false);
  useScrollToTop(listRef);
  const queryClient = useQueryClient();
  const session = useSessionStore(state => state.session);
  const sessionProfile = useSessionStore(state => state.profile);
  const city = useEventFilterStore(state => state.city);
  const categories = useEventFilterStore(state => state.categories);
  const date = useEventFilterStore(state => state.date);
  const sort = useEventFilterStore(state => state.sort);
  const initializedUserId = useEventFilterStore(
    state => state.initializedUserId,
  );
  const initializeUserCity = useEventFilterStore(
    state => state.initializeUserCity,
  );
  const resetFilters = useEventFilterStore(state => state.resetFilters);
  const userId = session?.user.id ?? null;
  const profile = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: () => getProfile(),
    enabled: Boolean(userId && !sessionProfile?.city),
  });
  const profileCity = sessionProfile?.city ?? profile.data?.city ?? null;
  const profileReady = Boolean(sessionProfile?.city) || profile.isFetched;

  useEffect(() => {
    if (userId && profileReady) initializeUserCity(userId, profileCity);
  }, [initializeUserCity, profileCity, profileReady, userId]);

  const filterKey = useMemo(
    () => ({ query: '', city, categories, date, sort }),
    [categories, city, date, sort],
  );
  const feedEnabled = !userId || initializedUserId === userId;
  const viewerId = userId ?? 'guest';
  const snapshot = useQuery({
    queryKey: queryKeys.events.snapshotFor(viewerId, filterKey),
    queryFn: () => loadEventFeedSnapshot(viewerId, filterKey),
    enabled: feedEnabled,
    staleTime: Infinity,
  });
  const preview = useQuery({
    queryKey: queryKeys.events.previewFor(filterKey),
    queryFn: ({ signal }) => searchEventPreview(filterKey, signal),
    enabled: feedEnabled,
    staleTime: 5 * 60 * 1000,
  });
  const events = useInfiniteQuery({
    queryKey: queryKeys.events.feed(filterKey),
    queryFn: ({ pageParam, signal }) =>
      searchEvents(filterKey, pageParam, signal),
    initialPageParam: null as import('./eventTypes').EventCursor | null,
    getNextPageParam: page => page.nextCursor,
    enabled: feedEnabled,
  });
  const eventSummary = useMemo(() => {
    const unique = new Map<string, Event>();
    for (const item of events.data?.pages.flatMap(page => page.items) ?? []) {
      unique.set(item.id, item);
    }
    return { items: [...unique.values()] };
  }, [events.data]);
  const items = useMemo(() => {
    if (events.isSuccess) return eventSummary.items;
    if (preview.data?.items.length) return preview.data.items;
    return snapshot.data ?? [];
  }, [eventSummary.items, events.isSuccess, preview.data, snapshot.data]);
  const latestTimestamp = useMemo(
    () =>
      items.reduce(
        (latest, item) => Math.max(latest, new Date(item.startAt).getTime()),
        0,
      ),
    [items],
  );

  useEffect(() => {
    if (!feedEnabled || items.length === 0) return;
    void saveEventFeedSnapshot(viewerId, filterKey, items);
  }, [feedEnabled, filterKey, items, viewerId]);

  useEffect(() => {
    void prefetchAppImages(items.slice(0, 4).map(event => event.imageUrl));
  }, [items]);
  const saveMutation = useMutation({
    mutationFn: ({ event, saved }: { event: Event; saved: boolean }) =>
      setEventSaved(event, saved),
    onMutate: async variables => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.all });
      await queryClient.cancelQueries({ queryKey: queryKeys.events.preview });
      const previousFeeds = queryClient.getQueriesData({
        queryKey: queryKeys.events.all,
      });
      const previousPreviews = queryClient.getQueriesData({
        queryKey: queryKeys.events.preview,
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.events.all },
        (old: typeof events.data) =>
          old
            ? {
                ...old,
                pages: old.pages.map(page => ({
                  ...page,
                  items: page.items.map(event =>
                    event.id === variables.event.id
                      ? { ...event, saved: variables.saved }
                      : event,
                  ),
                })),
              }
            : old,
      );
      queryClient.setQueriesData<EventPage>(
        { queryKey: queryKeys.events.preview },
        old =>
          old
            ? {
                ...old,
                items: old.items.map(event =>
                  event.id === variables.event.id
                    ? { ...event, saved: variables.saved }
                    : event,
                ),
              }
            : old,
      );
      return { previousFeeds, previousPreviews };
    },
    onError: (error, _variables, context) => {
      for (const [queryKey, data] of context?.previousFeeds ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      for (const [queryKey, data] of context?.previousPreviews ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      Alert.alert('Etkinlik kaydedilemedi', toAppError(error).message);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.all,
        refetchType: 'none',
      }),
  });

  function renderItem({ item }: { item: Event }) {
    return (
      <View style={styles.cardWrap}>
        <EventCard
          event={item}
          type="standard"
          onPress={() =>
            navigation.navigate('EventDetail', { eventId: item.id })
          }
          onToggleSaved={() =>
            saveMutation.mutate({ event: item, saved: !item.saved })
          }
        />
      </View>
    );
  }

  const filtersActive =
    Boolean(city) ||
    categories.length > 0 ||
    date !== 'all' ||
    sort !== 'upcoming';

  async function refreshEvents() {
    if (refreshing) return;
    setRefreshing(true);
    clearEventFeedCache();
    const fullRefresh = events.refetch();
    try {
      await preview.refetch();
    } finally {
      setRefreshing(false);
      void fullRefresh;
    }
  }

  const loading =
    items.length === 0 &&
    (snapshot.isLoading || preview.isLoading || events.isLoading);
  const failed =
    items.length === 0 &&
    preview.isError &&
    events.isError &&
    snapshot.isFetched;

  return (
    <Screen
      contentStyle={styles.screen}
      safeAreaEdges={mainTabSafeAreaEdges}
      testID="discover-screen"
    >
      <ConnectivityBanner />
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image
            source={require('../../assets/images/etkinlink-symbol.png')}
            style={styles.brandIcon}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <AppText variant="heading22" tone="brand">
            EtkinLink
          </AppText>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon={Search}
            label="Etkinlik ara"
            onPress={() => navigation.navigate('EventSearch')}
          />
          <IconButton
            icon={SlidersHorizontal}
            label="Etkinlik filtreleri"
            selected={filtersActive}
            onPress={() => navigation.navigate('EventFilters')}
          />
        </View>
      </View>

      {loading || (userId && initializedUserId !== userId) ? (
        <DiscoverSkeleton />
      ) : failed ? (
        <RefreshableContent
          refreshing={refreshing}
          onRefresh={() => void refreshEvents()}
        >
          <ErrorState
            title="Etkinlikler yüklenemedi"
            description={toAppError(events.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void refreshEvents()}
          />
        </RefreshableContent>
      ) : items.length === 0 ? (
        <RefreshableContent
          refreshing={refreshing}
          onRefresh={() => void refreshEvents()}
        >
          <StateView
            title="Etkinlik bulunamadı"
            description="Şehir, kategori veya tarih filtrelerini değiştirerek tekrar deneyebilirsin."
            actionLabel="Filtreleri temizle"
            onAction={resetFilters}
          />
        </RefreshableContent>
      ) : (
        <FlashList
          ref={listRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refreshEvents()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          onEndReached={() => {
            if (events.hasNextPage && !events.isFetchingNextPage)
              void events.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitle}>
                <AppText variant="heading18">Yaklaşan Etkinlikler</AppText>
                <AppText variant="caption12" tone="secondary">
                  {latestTimestamp > 0
                    ? `${items.length} etkinlik · ${feedEndDateFormatter.format(
                        latestTimestamp,
                      )} tarihine kadar`
                    : 'İlgi alanlarına uygun etkinlikleri keşfet'}
                </AppText>
              </View>
              <AppText variant="caption12" tone="brand" numberOfLines={1}>
                {city ?? 'Tüm şehirler'}
              </AppText>
            </View>
          }
          ListFooterComponent={
            events.isFetchingNextPage ? (
              <Skeleton style={styles.footerSkeleton} />
            ) : events.isFetching && !events.isSuccess ? (
              <AppText
                variant="caption12"
                tone="secondary"
                style={styles.backgroundLoading}
              >
                Diğer tarih ve kategoriler arka planda yükleniyor…
              </AppText>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

function DiscoverSkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton style={styles.cardSkeleton} />
      <Skeleton style={styles.cardSkeleton} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    minHeight: layout.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brandIcon: { width: 30, height: 30 },
  sectionHeader: {
    minHeight: 60,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionTitle: { flex: 1, gap: 2 },
  listContent: { paddingBottom: spacing.xl },
  cardWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  skeletonWrap: { paddingHorizontal: spacing.md, gap: spacing.md },
  cardSkeleton: { height: 220 },
  footerSkeleton: {
    height: 64,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  backgroundLoading: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
});

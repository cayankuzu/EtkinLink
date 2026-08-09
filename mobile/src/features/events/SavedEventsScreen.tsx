import type { DiscoverStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  IconButton,
  RefreshableContent,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { colors, spacing } from '@shared/theme';
import { FlashList } from '@shopify/flash-list';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { EventCard } from './EventCard';
import { listSavedEvents, setEventSaved } from './eventService';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'SavedEvents'>;

export function SavedEventsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const saved = useInfiniteQuery({
    queryKey: ['saved-events'],
    queryFn: ({ pageParam }) => listSavedEvents(pageParam),
    initialPageParam: null as { savedAt: string; eventId: string } | null,
    getNextPageParam: page => page.nextCursor,
  });
  const items = saved.data?.pages.flatMap(page => page.items) ?? [];
  const removeSaved = useMutation({
    mutationFn: (event: import('@shared/types/domain').Event) =>
      setEventSaved(event, false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saved-events'] });
      void queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">Kaydedilenler</AppText>
        <View style={styles.spacer} />
      </View>
      {saved.isLoading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </View>
      ) : saved.isError ? (
        <RefreshableContent
          refreshing={saved.isRefetching}
          onRefresh={() => void saved.refetch()}
        >
          <ErrorState
            title="Kaydedilenler yüklenemedi"
            description={toAppError(saved.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void saved.refetch()}
          />
        </RefreshableContent>
      ) : items.length === 0 ? (
        <RefreshableContent
          refreshing={saved.isRefetching}
          onRefresh={() => void saved.refetch()}
        >
          <StateView
            title="Kaydettiğin etkinlik yok"
            description="Keşfetteki yer imi düğmesine dokunduğun etkinlikler burada görünür."
          />
        </RefreshableContent>
      ) : (
        <FlashList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.item}>
              <EventCard
                event={item}
                type="standard"
                onPress={() =>
                  navigation.navigate('EventDetail', { eventId: item.id })
                }
                onToggleSaved={() => removeSaved.mutate(item)}
              />
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={saved.isRefetching && !saved.isFetchingNextPage}
              onRefresh={() => void saved.refetch()}
              tintColor={colors.brand}
            />
          }
          onEndReached={() => {
            if (saved.hasNextPage && !saved.isFetchingNextPage)
              void saved.fetchNextPage();
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  spacer: { width: 48 },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  item: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  skeletons: { padding: spacing.md, gap: spacing.sm },
  skeleton: { height: 124 },
});

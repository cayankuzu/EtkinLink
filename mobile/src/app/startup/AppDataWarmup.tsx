import { useEventFilterStore } from '@features/events/eventFilterStore';
import { searchEventPreview } from '@features/events/eventService';
import { listMatches } from '@features/messages/messageService';
import { listRooms } from '@features/rooms/roomService';
import NetInfo from '@react-native-community/netinfo';
import { prefetchAppImages } from '@shared/components';
import { queryClient } from '@shared/lib/queryClient';
import { queryKeys } from '@shared/lib/queryKeys';
import { recordPerformance } from '@shared/lib/telemetry';
import { useEffect } from 'react';
import { AppState, InteractionManager } from 'react-native';

type Props = { enabled: boolean };

export function AppDataWarmup({ enabled }: Props) {
  useEffect(() => {
    if (!enabled || AppState.currentState !== 'active') return undefined;
    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const interaction = InteractionManager.runAfterInteractions(() => {
      timers.push(
        setTimeout(() => {
          void warmVisibleDiscover().catch(() => undefined);
        }, 450),
        setTimeout(() => {
          if (cancelled) return;
          void warmAdjacentTabs().catch(() => undefined);
        }, 1_200),
      );
    });

    return () => {
      cancelled = true;
      interaction.cancel();
      timers.forEach(clearTimeout);
    };
  }, [enabled]);

  return null;
}

async function canWarmSpeculatively(): Promise<boolean> {
  const network = await NetInfo.fetch();
  return Boolean(
    network.isConnected &&
      network.isInternetReachable !== false &&
      !network.details?.isConnectionExpensive,
  );
}

async function warmVisibleDiscover(): Promise<void> {
  if (!(await canWarmSpeculatively())) return;
  const { city, categories, date, sort } = useEventFilterStore.getState();
  const filters = { query: '', city, categories, date, sort };
  const startedAt = global.performance?.now?.() ?? Date.now();
  const preview = await queryClient.fetchQuery({
    queryKey: queryKeys.events.previewFor(filters),
    queryFn: () => searchEventPreview(filters),
    staleTime: 5 * 60_000,
  });
  await prefetchAppImages(
    preview.items.slice(0, 4).map(event => event.imageUrl),
  );
  recordPerformance(
    'warmup.discover',
    (global.performance?.now?.() ?? Date.now()) - startedAt,
  );
}

async function warmAdjacentTabs(): Promise<void> {
  if (!(await canWarmSpeculatively())) return;
  await Promise.allSettled([
    queryClient.prefetchInfiniteQuery({
      queryKey: queryKeys.rooms.all,
      queryFn: ({ pageParam }) => listRooms(pageParam),
      initialPageParam: null,
      getNextPageParam: () => undefined,
      staleTime: 60_000,
    }),
    queryClient.prefetchInfiniteQuery({
      queryKey: queryKeys.messages.matchList('all'),
      queryFn: ({ pageParam }) => listMatches('all', pageParam),
      initialPageParam: null,
      getNextPageParam: () => undefined,
      staleTime: 60_000,
    }),
  ]);
}

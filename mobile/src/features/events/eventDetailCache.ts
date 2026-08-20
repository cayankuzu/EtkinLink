import { queryKeys } from '@shared/lib/queryKeys';
import type { Event } from '@shared/types/domain';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { EventPage } from './eventTypes';

function isSameEvent(candidate: Event, target: Event): boolean {
  return (
    candidate.id === target.id ||
    (candidate.externalId !== null &&
      candidate.externalId === target.externalId) ||
    (candidate.databaseId != null && candidate.databaseId === target.databaseId)
  );
}

function updateEventList(
  items: Event[],
  target: Event,
  update: Partial<Event>,
): Event[] {
  return items.map(item =>
    isSameEvent(item, target) ? { ...item, ...update } : item,
  );
}

function updateFeedPage(
  page: EventPage,
  target: Event,
  update: Partial<Event>,
): EventPage {
  return {
    ...page,
    items: updateEventList(page.items, target, update),
  };
}

export function updateEventCaches(
  queryClient: QueryClient,
  eventQueryId: string,
  target: Event,
  update: Partial<Event>,
): void {
  queryClient.setQueryData<Event>(
    queryKeys.events.detail(eventQueryId),
    current => (current ? { ...current, ...update } : current),
  );
  queryClient.setQueriesData<InfiniteData<EventPage>>(
    { queryKey: queryKeys.events.all },
    current =>
      current
        ? {
            ...current,
            pages: current.pages.map(page =>
              updateFeedPage(page, target, update),
            ),
          }
        : current,
  );
  queryClient.setQueriesData<EventPage>(
    { queryKey: queryKeys.events.preview },
    current => (current ? updateFeedPage(current, target, update) : current),
  );
  for (const key of [queryKeys.events.snapshot, queryKeys.events.searchIndex]) {
    queryClient.setQueriesData<Event[]>({ queryKey: key }, current =>
      current ? updateEventList(current, target, update) : current,
    );
  }
  queryClient.setQueriesData<
    InfiniteData<{ items: Event[]; nextCursor: unknown }>
  >({ queryKey: queryKeys.events.saved }, current =>
    current
      ? {
          ...current,
          pages: current.pages.map(page => ({
            ...page,
            items: updateEventList(page.items, target, update),
          })),
        }
      : current,
  );
}

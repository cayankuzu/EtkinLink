import type { Event } from '@shared/types/domain';
import * as FileSystem from 'expo-file-system/legacy';

import type { EventFilters } from './eventTypes';

const snapshotUri = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}event-feed-snapshot-v1.json`
  : null;
const snapshotMaxAgeMs = 24 * 60 * 60 * 1000;

type EventFeedSnapshot = {
  version: 1;
  viewerId: string;
  filterKey: string;
  storedAt: number;
  items: Event[];
};

function serializeFilters(filters: EventFilters): string {
  return JSON.stringify({
    query: filters.query,
    city: filters.city,
    categories: [...filters.categories].sort((left, right) =>
      left.localeCompare(right, 'tr-TR'),
    ),
    date: filters.date,
    sort: filters.sort,
  });
}

export async function loadEventFeedSnapshot(
  viewerId: string,
  filters: EventFilters,
): Promise<Event[] | null> {
  if (!snapshotUri) return null;
  try {
    const value = JSON.parse(
      await FileSystem.readAsStringAsync(snapshotUri),
    ) as Partial<EventFeedSnapshot>;
    if (
      value.version !== 1 ||
      value.viewerId !== viewerId ||
      value.filterKey !== serializeFilters(filters) ||
      typeof value.storedAt !== 'number' ||
      Date.now() - value.storedAt > snapshotMaxAgeMs ||
      !Array.isArray(value.items)
    ) {
      return null;
    }
    return value.items;
  } catch {
    return null;
  }
}

export async function saveEventFeedSnapshot(
  viewerId: string,
  filters: EventFilters,
  items: Event[],
): Promise<void> {
  if (!snapshotUri || items.length === 0) return;
  const value: EventFeedSnapshot = {
    version: 1,
    viewerId,
    filterKey: serializeFilters(filters),
    storedAt: Date.now(),
    items,
  };
  try {
    await FileSystem.writeAsStringAsync(snapshotUri, JSON.stringify(value));
  } catch {
    // The feed remains usable when the operating system clears its cache.
  }
}

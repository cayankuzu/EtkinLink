import type { Event } from '@shared/types/domain';
import * as FileSystem from 'expo-file-system/legacy';

import type { EventFilters } from './eventTypes';

const legacySnapshotUri = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}event-feed-snapshot-v1.json`
  : null;
const snapshotUri = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}event-feed-snapshot-v2.json`
  : null;
const snapshotMaxAgeMs = 24 * 60 * 60 * 1000;

type EventFeedSnapshot = {
  version: 2;
  viewerId: string;
  filterKey: string;
  storedAt: number;
  items: Event[];
};

function sanitizeEventForSnapshot(event: Event): Event {
  const snapshot = { ...event, joined: false, saved: false };
  delete snapshot.attendeePhotoUrls;
  return snapshot;
}

async function removeSnapshot(uri: string | null): Promise<void> {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

async function removeSnapshotBestEffort(uri: string | null): Promise<void> {
  try {
    await removeSnapshot(uri);
  } catch {
    // Snapshot cleanup is best-effort when the operating system owns the cache.
  }
}

export async function clearEventFeedSnapshot(): Promise<void> {
  await Promise.all([
    removeSnapshot(snapshotUri),
    removeSnapshot(legacySnapshotUri),
  ]);
}

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
  await removeSnapshotBestEffort(legacySnapshotUri);
  try {
    const value = JSON.parse(
      await FileSystem.readAsStringAsync(snapshotUri),
    ) as Partial<EventFeedSnapshot>;
    if (
      value.version !== 2 ||
      value.viewerId !== viewerId ||
      value.filterKey !== serializeFilters(filters) ||
      typeof value.storedAt !== 'number' ||
      Date.now() - value.storedAt > snapshotMaxAgeMs ||
      !Array.isArray(value.items)
    ) {
      await removeSnapshotBestEffort(snapshotUri);
      return null;
    }
    return value.items.map(sanitizeEventForSnapshot);
  } catch {
    await removeSnapshotBestEffort(snapshotUri);
    return null;
  }
}

export async function saveEventFeedSnapshot(
  viewerId: string,
  filters: EventFilters,
  items: Event[],
): Promise<void> {
  if (!snapshotUri) return;
  await removeSnapshotBestEffort(legacySnapshotUri);
  if (items.length === 0) {
    await removeSnapshotBestEffort(snapshotUri);
    return;
  }
  const value: EventFeedSnapshot = {
    version: 2,
    viewerId,
    filterKey: serializeFilters(filters),
    storedAt: Date.now(),
    items: items.map(sanitizeEventForSnapshot),
  };
  try {
    await FileSystem.writeAsStringAsync(snapshotUri, JSON.stringify(value));
  } catch {
    // The feed remains usable when the operating system clears its cache.
  }
}

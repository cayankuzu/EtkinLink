const mockFiles = new Map<string, string>();

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file://test-cache/',
  readAsStringAsync: jest.fn(async (uri: string) => {
    const value = mockFiles.get(uri);
    if (value === undefined) throw new Error('File not found');
    return value;
  }),
  writeAsStringAsync: jest.fn(async (uri: string, value: string) => {
    mockFiles.set(uri, value);
  }),
  deleteAsync: jest.fn(async (uri: string) => {
    mockFiles.delete(uri);
  }),
}));

import type { Event } from '@shared/types/domain';
import * as FileSystem from 'expo-file-system/legacy';

import {
  clearEventFeedSnapshot,
  loadEventFeedSnapshot,
  saveEventFeedSnapshot,
} from './eventFeedSnapshot';
import type { EventFilters } from './eventTypes';

const deleteAsync = jest.mocked(FileSystem.deleteAsync);

const filters: EventFilters = {
  query: '',
  city: 'Istanbul',
  categories: ['Music'],
  date: 'all',
  sort: 'upcoming',
};

const personalizedEvent: Event = {
  id: 'event-1',
  databaseId: 'database-1',
  externalId: 1,
  title: 'Concert',
  summary: null,
  description: null,
  startAt: '2026-09-10T18:00:00.000Z',
  endAt: null,
  venue: null,
  city: 'Istanbul',
  district: null,
  address: null,
  imageUrl: 'https://cdn.example.com/event.jpg',
  categories: ['Music'],
  sourceUrl: 'https://example.com/event',
  attendeeCount: 2,
  attendeePhotoUrls: [
    'https://project.supabase.co/storage/v1/object/sign/profile-photos/user/a.jpg?token=secret',
  ],
  joined: true,
  saved: true,
  roomOpen: true,
};

describe('event feed disk snapshot privacy', () => {
  beforeEach(() => {
    mockFiles.clear();
    deleteAsync.mockClear();
  });

  it('does not persist signed attendee URLs or personalized flags', async () => {
    await saveEventFeedSnapshot('viewer-1', filters, [personalizedEvent]);

    const raw = mockFiles.get('file://test-cache/event-feed-snapshot-v2.json');
    if (!raw) throw new Error('The test snapshot was not written.');
    const persisted = JSON.parse(raw) as { items: Event[] };
    expect(persisted.items[0]).toEqual(
      expect.objectContaining({ joined: false, saved: false }),
    );
    expect(persisted.items[0]).not.toHaveProperty('attendeePhotoUrls');
    expect(raw).not.toContain('token=secret');

    await expect(loadEventFeedSnapshot('viewer-1', filters)).resolves.toEqual([
      expect.objectContaining({ joined: false, saved: false }),
    ]);
  });

  it('explicitly purges both current and legacy snapshot files', async () => {
    mockFiles.set('file://test-cache/event-feed-snapshot-v1.json', 'legacy');
    mockFiles.set('file://test-cache/event-feed-snapshot-v2.json', 'current');

    await clearEventFeedSnapshot();

    expect(deleteAsync).toHaveBeenCalledWith(
      'file://test-cache/event-feed-snapshot-v1.json',
      { idempotent: true },
    );
    expect(mockFiles.size).toBe(0);
    expect(deleteAsync).toHaveBeenCalledWith(
      'file://test-cache/event-feed-snapshot-v2.json',
      { idempotent: true },
    );
  });
});

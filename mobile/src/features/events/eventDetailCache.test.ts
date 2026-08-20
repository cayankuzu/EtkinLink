import type { Event } from '@shared/types/domain';
import { QueryClient } from '@tanstack/react-query';

import { updateEventCaches } from './eventDetailCache';

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'source-1',
    databaseId: 'database-1',
    externalId: 11,
    title: 'Etkinlik',
    summary: '',
    description: '',
    startAt: '2026-08-20T12:00:00.000Z',
    endAt: null,
    venue: null,
    city: 'İstanbul',
    district: null,
    address: null,
    imageUrl: null,
    categories: [],
    sourceUrl: 'https://example.test/event',
    attendeeCount: 0,
    attendeePhotoUrls: [],
    joined: false,
    saved: false,
    roomOpen: false,
    sourceDetails: undefined,
    ...overrides,
  };
}

describe('event detail cache güncellemesi', () => {
  it('detail, feed, preview, snapshot, arama ve saved kopyalarını birlikte günceller', () => {
    const queryClient = new QueryClient();
    const target = event();
    const byExternalId = event({ id: 'other', databaseId: null });
    const byDatabaseId = event({ id: 'third', externalId: null });
    const unrelated = event({
      id: 'unrelated',
      databaseId: 'database-2',
      externalId: 22,
    });
    const page = { items: [byExternalId, unrelated], nextCursor: null };
    queryClient.setQueryData(['event', 'route-id'], target);
    queryClient.setQueryData(['events', 'filter'], {
      pages: [page],
      pageParams: [null],
    });
    queryClient.setQueryData(['events-preview', 'filter'], page);
    queryClient.setQueryData(['events-snapshot', 'user'], [byDatabaseId]);
    queryClient.setQueryData(['event-search-index', 'complete'], [target]);
    queryClient.setQueryData(['saved-events'], {
      pages: [{ items: [target], nextCursor: null }],
      pageParams: [null],
    });

    updateEventCaches(queryClient, 'route-id', target, {
      saved: true,
      attendeeCount: 4,
    });

    expect(queryClient.getQueryData<Event>(['event', 'route-id'])).toEqual(
      expect.objectContaining({ saved: true, attendeeCount: 4 }),
    );
    expect(
      queryClient.getQueryData<{ pages: Array<{ items: Event[] }> }>([
        'events',
        'filter',
      ])?.pages[0]?.items,
    ).toEqual([
      expect.objectContaining({ id: 'other', saved: true }),
      unrelated,
    ]);
    expect(
      queryClient.getQueryData<{ items: Event[] }>(['events-preview', 'filter'])
        ?.items[0],
    ).toEqual(expect.objectContaining({ saved: true }));
    expect(
      queryClient.getQueryData<Event[]>(['events-snapshot', 'user'])?.[0],
    ).toEqual(expect.objectContaining({ saved: true }));
    expect(
      queryClient.getQueryData<Event[]>([
        'event-search-index',
        'complete',
      ])?.[0],
    ).toEqual(expect.objectContaining({ saved: true }));
    expect(
      queryClient.getQueryData<{ pages: Array<{ items: Event[] }> }>([
        'saved-events',
      ])?.pages[0]?.items[0],
    ).toEqual(expect.objectContaining({ saved: true }));
    queryClient.clear();
  });

  it('boş cache girişlerini yaratmaz', () => {
    const queryClient = new QueryClient();
    updateEventCaches(queryClient, 'missing', event(), { joined: true });
    expect(queryClient.getQueryData(['event', 'missing'])).toBeUndefined();
    queryClient.clear();
  });
});

jest.mock('@shared/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import type { Event } from '@shared/types/domain';

import {
  cacheApiEvents,
  clearApiEventCache,
  getCachedApiEvent,
} from './etkinlikApiService';

const event: Event = {
  id: 'api-event-1',
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
  imageUrl: null,
  categories: ['Music'],
  sourceUrl: 'https://example.com/event',
  attendeeCount: 3,
  attendeePhotoUrls: ['https://example.com/profile.jpg?token=secret'],
  joined: true,
  saved: true,
};

describe('Etkinlik.io API memory cache cleanup', () => {
  afterEach(clearApiEventCache);

  it('removes cached personalized event state', () => {
    cacheApiEvents([event]);
    expect(getCachedApiEvent(event.id)).toBe(event);

    clearApiEventCache();

    expect(getCachedApiEvent(event.id)).toBeUndefined();
  });
});

const mockFetch = jest.fn();
const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@shared/config/env', () => ({
  env: { edgeApiBaseUrl: 'https://api.etkinlink.example' },
}));
jest.mock('@shared/lib/network', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
  readResponseTextLimited: (response: Response) => response.text(),
}));
jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import type { Event } from '@shared/types/domain';

import { clearApiEventCache, searchApiEvents } from './etkinlikApiService';
import type { EventFilters } from './eventTypes';

const filters: EventFilters = {
  query: '',
  city: null,
  categories: [],
  date: 'all',
  sort: 'upcoming',
};

const event: Event = {
  id: 'etkinlik-io-1',
  externalId: 1,
  title: 'Konser',
  summary: null,
  description: null,
  startAt: '2026-09-10T18:00:00.000Z',
  endAt: null,
  venue: null,
  city: 'İstanbul',
  district: null,
  address: null,
  imageUrl: null,
  categories: ['Müzik'],
  sourceUrl: 'https://etkinlik.io/etkinlik/1',
  attendeeCount: 0,
  joined: false,
  saved: false,
};

describe('selective event edge transport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearApiEventCache();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
      error: null,
    });
  });

  it('mevcut POST DTO sözleşmesini bearer token ile edge gatewaye taşır', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ events: [event], total: 1, nextSkip: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(searchApiEvents(filters)).resolves.toEqual({
      items: [event],
      nextCursor: null,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.etkinlink.example/v1/events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('yalnız transient edge arızasında direct-origin rollback yolunu kullanır', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'origin unavailable' }), {
        status: 503,
      }),
    );
    mockInvoke.mockResolvedValue({
      data: { events: [event], total: 1, nextSkip: null },
      error: null,
    });

    await expect(searchApiEvents(filters)).resolves.toMatchObject({
      items: [event],
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('auth reddini origin bypass ile aşmaz', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid jwt details' }), {
        status: 401,
      }),
    );

    await expect(searchApiEvents(filters)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('edge rate limitini direct-origin fallback ile bypass etmez', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
      }),
    );

    await expect(searchApiEvents(filters)).rejects.toMatchObject({
      code: 'rate_limit',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

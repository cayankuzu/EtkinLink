jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    functions: { invoke: jest.fn() },
    rpc: jest.fn(),
  },
}));
jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));
jest.mock('./etkinlikApiService', () => ({
  cacheApiEvents: jest.fn(),
  clearApiEventCache: jest.fn(),
  getApiEvent: jest.fn(),
  getCachedApiEvent: jest.fn(),
  listApiEventCategories: jest.fn(),
  loadUniversalApiBroadIndex: jest.fn(),
  loadUniversalApiIndex: jest.fn(),
  loadUniversalApiPreview: jest.fn(),
  searchApiEvents: jest.fn(),
}));
jest.mock('./rssEventService', () => ({
  applyRssFilters: jest.fn(),
  cacheRssEvents: jest.fn(),
  clearRssFeedCache: jest.fn(),
  getCachedRssEvent: jest.fn(),
  getRssEvent: jest.fn(),
  getRssEventPreview: jest.fn(),
  isRssEventId: jest.fn((id: string) => id.startsWith('source-')),
  listRssCategories: jest.fn(),
  loadUniversalRssBroadIndex: jest.fn(),
  loadUniversalRssIndex: jest.fn(),
  loadUniversalRssPreview: jest.fn(),
  searchRssEvents: jest.fn(),
  searchRssEventsPreview: jest.fn(),
}));

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import type { Event } from '@shared/types/domain';

import { createSupabaseBuilder } from '../../test/supabaseMock';
import * as api from './etkinlikApiService';
import {
  cacheEventCardState,
  clearEventFeedCache,
  filterUniversalEventSearch,
  getCachedEvent,
  getEvent,
  joinEvent,
  leaveEvent,
  listEventCategories,
  listSavedEvents,
  loadUniversalEventSearchBroadIndex,
  loadUniversalEventSearchIndex,
  loadUniversalEventSearchPreview,
  searchEventPreview,
  searchEvents,
  setEventSaved,
} from './eventService';
import * as rss from './rssEventService';

const mockRpc = jest.mocked(supabase.rpc);
const mockFrom = jest.mocked(supabase.from);
const mockGetUser = jest.mocked(supabase.auth.getUser);
const mockInvoke = jest.mocked(supabase.functions.invoke);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'source-1',
    databaseId: null,
    externalId: 1,
    title: 'Konser',
    summary: 'Özet',
    description: 'Açıklama',
    startAt: '2026-09-10T18:00:00.000Z',
    endAt: null,
    venue: 'Salon',
    city: 'İstanbul',
    district: null,
    address: null,
    imageUrl: 'https://example.test/event.jpg',
    categories: ['Müzik'],
    sourceUrl: 'https://example.test/event',
    attendeeCount: 0,
    attendeePhotoUrls: [],
    joined: false,
    saved: false,
    roomOpen: false,
    ...overrides,
  };
}

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'database-1',
    external_id: 1,
    title: 'DB konser',
    summary: 'DB özet',
    description: 'DB açıklama',
    start_at: '2026-09-10T18:00:00.000Z',
    end_at: '2026-09-10T21:00:00.000Z',
    venue: 'DB salon',
    city: 'Ankara',
    district: 'Çankaya',
    address: 'Adres',
    image_url: null,
    categories: ['Müzik'],
    source_url: 'https://example.test/event',
    attendee_count: 4,
    joined: true,
    saved: true,
    room_open: true,
    saved_at: '2026-08-19T10:00:00.000Z',
    ...overrides,
  };
}

describe('eventService davranış regresyonları', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedUrls.mockResolvedValue(
      new Map([['user/photo.jpg', 'https://cdn.example/photo.jpg']]),
    );
    jest.mocked(api.getCachedApiEvent).mockReturnValue(undefined);
    jest.mocked(rss.getCachedRssEvent).mockReturnValue(undefined);
  });

  it('API sonucunu tekilleştirilmiş kart durumu ve imzalı katılımcı fotoğrafıyla zenginleştirir', async () => {
    jest.mocked(api.searchApiEvents).mockResolvedValue({
      items: [event(), event({ id: 'source-duplicate' })],
      nextCursor: null,
    });
    mockRpc.mockReturnValue(
      createSupabaseBuilder({
        data: [
          {
            external_id: 1,
            database_id: 'database-1',
            attendee_count: 3,
            attendee_photo_paths: ['user/photo.jpg'],
            joined: true,
            saved: true,
          },
        ],
        error: null,
      }) as never,
    );

    const result = await searchEvents({} as never);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        databaseId: 'database-1',
        attendeeCount: 3,
        attendeePhotoUrls: ['https://cdn.example/photo.jpg'],
        joined: true,
        saved: true,
      }),
      expect.objectContaining({ databaseId: 'database-1' }),
    ]);
    expect(api.cacheApiEvents).toHaveBeenCalledWith(result.items);
    expect(rss.cacheRssEvents).toHaveBeenCalledWith(result.items);
  });

  it('API ve kart-state hatalarında RSS sonucundaki son güvenli cache durumunu korur', async () => {
    const cached = event({ attendeeCount: 8, joined: true, saved: true });
    jest
      .mocked(api.searchApiEvents)
      .mockRejectedValue(new Error('Network request failed'));
    jest.mocked(rss.searchRssEvents).mockResolvedValue({
      items: [event()],
      nextCursor: null,
    });
    jest.mocked(api.getCachedApiEvent).mockReturnValue(cached);
    mockRpc.mockReturnValue(
      createSupabaseBuilder({
        data: [],
        error: { message: 'state kapalı' },
      }) as never,
    );

    const result = await searchEvents({} as never, { offset: 12 });

    expect(rss.searchRssEvents).toHaveBeenCalled();
    expect(result.items[0]).toEqual(
      expect.objectContaining({ attendeeCount: 8, joined: true, saved: true }),
    );
  });

  it('imzalı fotoğraf üretimi hata verirse son güvenli kart durumunu korur', async () => {
    const cached = event({ attendeeCount: 9, joined: true });
    jest.mocked(api.searchApiEvents).mockResolvedValue({
      items: [event()],
      nextCursor: null,
    });
    jest.mocked(api.getCachedApiEvent).mockReturnValue(cached);
    mockRpc.mockReturnValue(
      createSupabaseBuilder({
        data: [
          {
            external_id: 1,
            database_id: 'database-1',
            attendee_count: 3,
            attendee_photo_paths: ['user/photo.jpg'],
            joined: false,
            saved: false,
          },
        ],
        error: null,
      }) as never,
    );
    mockSignedUrls.mockRejectedValueOnce(new Error('signing unavailable'));

    await expect(searchEvents({} as never)).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ attendeeCount: 9, joined: true })],
      }),
    );
    expect(rss.cacheRssEvents).toHaveBeenCalledWith([
      expect.objectContaining({ attendeeCount: 9 }),
    ]);
  });

  it('preview ve evrensel indekslerde API başarısızsa RSS fallback kullanır', async () => {
    jest
      .mocked(api.searchApiEvents)
      .mockRejectedValue(new Error('Network request failed'));
    jest.mocked(rss.searchRssEventsPreview).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    await expect(searchEventPreview({} as never)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });

    const pairs = [
      [
        api.loadUniversalApiPreview,
        rss.loadUniversalRssPreview,
        loadUniversalEventSearchPreview,
      ],
      [
        api.loadUniversalApiBroadIndex,
        rss.loadUniversalRssBroadIndex,
        loadUniversalEventSearchBroadIndex,
      ],
      [
        api.loadUniversalApiIndex,
        rss.loadUniversalRssIndex,
        loadUniversalEventSearchIndex,
      ],
    ] as const;
    for (const [apiLoader, rssLoader, serviceLoader] of pairs) {
      jest
        .mocked(apiLoader)
        .mockRejectedValueOnce(new Error('Network request failed'));
      jest
        .mocked(rssLoader)
        .mockResolvedValueOnce([event({ externalId: null })]);
      await expect(serviceLoader()).resolves.toHaveLength(1);
    }
  });

  it('validation ve cancellation hatalarını RSS fallback ile gizlemez', async () => {
    jest
      .mocked(api.searchApiEvents)
      .mockRejectedValueOnce({ status: 400, message: 'invalid filter' });
    await expect(searchEvents({} as never)).rejects.toMatchObject({
      status: 400,
    });

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    jest.mocked(api.searchApiEvents).mockRejectedValueOnce(abort);
    await expect(searchEvents({} as never)).rejects.toBe(abort);
    expect(rss.searchRssEvents).not.toHaveBeenCalled();
  });

  it('iptal edilen detay isteğinde RSS detail fallback başlatmaz', async () => {
    const controller = new AbortController();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    controller.abort();
    jest.mocked(api.getApiEvent).mockRejectedValueOnce(abort);

    await expect(getEvent('source-cancelled', controller.signal)).rejects.toBe(
      abort,
    );
    expect(rss.getRssEventPreview).not.toHaveBeenCalled();
    expect(rss.getRssEvent).not.toHaveBeenCalled();
  });

  it('filtre, kategori fallback ve cache temizliğini doğru servislere yönlendirir', async () => {
    jest.mocked(rss.applyRssFilters).mockReturnValue([event()]);
    expect(filterUniversalEventSearch([event()], 'konser')).toHaveLength(1);
    expect(rss.applyRssFilters).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'source-1' })],
      expect.objectContaining({ query: 'konser', date: 'all' }),
    );

    jest
      .mocked(api.listApiEventCategories)
      .mockRejectedValue(new Error('Network request failed'));
    jest.mocked(rss.listRssCategories).mockResolvedValue(['Müzik']);
    await expect(listEventCategories()).resolves.toEqual(['Müzik']);
    clearEventFeedCache();
    expect(api.clearApiEventCache).toHaveBeenCalled();
    expect(rss.clearRssFeedCache).toHaveBeenCalled();
  });

  it('kaynak etkinliği bir kez senkronize eder ve DB katılım durumuyla birleştirir', async () => {
    const source = event({ id: 'source-sync-success', venue: null });
    jest.mocked(api.getApiEvent).mockResolvedValue(source);
    mockInvoke.mockResolvedValue({
      data: { event_id: 'database-1' },
      error: null,
    });
    mockRpc.mockReturnValue(
      createSupabaseBuilder({ data: [databaseRow()], error: null }) as never,
    );

    const [first, second] = await Promise.all([
      getEvent(source.id),
      getEvent(source.id),
    ]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(first).toEqual(
      expect.objectContaining({
        id: source.id,
        databaseId: 'database-1',
        venue: 'DB salon',
        attendeeCount: 4,
        joined: true,
      }),
    );
    expect(second.databaseId).toBe('database-1');
  });

  it('sync response içindeki güvenli sunucu hatasını kullanır ve kaynak fallback döndürür', async () => {
    const source = event({ id: 'source-sync-error' });
    jest.mocked(api.getApiEvent).mockResolvedValue(source);
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: 'invoke failed',
        context: new Response(JSON.stringify({ error: 'Senkron reddedildi' })),
      },
    } as never);

    await expect(getEvent(source.id)).resolves.toEqual(source);
    expect(api.getApiEvent).toHaveBeenCalledTimes(2);
  });

  it('sync hatasını ve eksik event_id yanıtını fail-closed ele alır', async () => {
    const first = event({ id: 'source-sync-plain-error' });
    const second = event({ id: 'source-sync-missing-id' });
    jest
      .mocked(api.getApiEvent)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(second);
    mockInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'invoke failed' },
      } as never)
      .mockResolvedValueOnce({ data: {}, error: null } as never);

    await expect(getEvent(first.id)).resolves.toBe(first);
    await expect(getEvent(second.id)).resolves.toBe(second);
  });

  it('kaynak detay yollarında API kesintisini RSS ile, tüm kaynakların kesintisini DB ile karşılar', async () => {
    const source = event({ id: 'source-rss-detail' });
    jest
      .mocked(api.getApiEvent)
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockRejectedValueOnce(new Error('Network request failed'));
    jest.mocked(rss.getRssEventPreview).mockResolvedValueOnce(source);
    jest.mocked(rss.getRssEvent).mockResolvedValueOnce(source);
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'sync unavailable' },
    } as never);
    await expect(getEvent(source.id)).resolves.toBe(source);

    mockRpc.mockReturnValueOnce(
      createSupabaseBuilder({ data: [databaseRow()], error: null }) as never,
    );
    jest
      .mocked(api.getApiEvent)
      .mockRejectedValueOnce(new Error('Network request failed'));
    jest
      .mocked(rss.getRssEvent)
      .mockRejectedValueOnce(new Error('Network request failed'));
    await expect(getEvent('database-source-unavailable')).resolves.toEqual(
      expect.objectContaining({ id: 'database-1', attendeeCount: 4 }),
    );
  });

  it('DB etkinliğinde kaynak bulunamazsa DB verisini, bulunursa kaynak ayrıntısını korur', async () => {
    mockRpc
      .mockReturnValueOnce(
        createSupabaseBuilder({
          data: [databaseRow({ external_id: null })],
          error: null,
        }) as never,
      )
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: [databaseRow()], error: null }) as never,
      );
    await expect(getEvent('database-local')).resolves.toEqual(
      expect.objectContaining({ id: 'database-1', externalId: null }),
    );

    jest
      .mocked(api.getApiEvent)
      .mockRejectedValue(new Error('Network request failed'));
    jest
      .mocked(rss.getRssEvent)
      .mockResolvedValue(event({ id: 'source-1', title: 'Kaynak başlığı' }));
    await expect(getEvent('database-with-source')).resolves.toEqual(
      expect.objectContaining({
        id: 'database-1',
        title: 'Kaynak başlığı',
        attendeeCount: 4,
      }),
    );
  });

  it('saved pagination ile kart cache yardımcılarını tutarlı çalıştırır', async () => {
    mockRpc.mockReturnValue(
      createSupabaseBuilder({
        data: Array.from({ length: 30 }, (_, index) =>
          databaseRow({ id: `database-${index}` }),
        ),
        error: null,
      }) as never,
    );
    const page = await listSavedEvents();
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toEqual({
      savedAt: '2026-08-19T10:00:00.000Z',
      eventId: 'database-29',
    });

    const cached = event();
    jest.mocked(api.getCachedApiEvent).mockReturnValue(cached);
    expect(getCachedEvent(cached.id)).toBe(cached);
    expect(getCachedEvent('database-1')).toBeUndefined();
    cacheEventCardState(cached);
    expect(api.cacheApiEvents).toHaveBeenCalledWith([cached]);
    expect(rss.cacheRssEvents).toHaveBeenCalledWith([cached]);
  });

  it('kaydetme duplicate inserti tolere eder, silme ve RPC hatalarını iletir', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    } as never);
    const insert = createSupabaseBuilder({
      data: null,
      error: { code: '23505', message: 'duplicate' },
    });
    const remove = createSupabaseBuilder({ data: null, error: null });
    mockFrom
      .mockReturnValueOnce(insert as never)
      .mockReturnValueOnce(remove as never);

    await expect(
      setEventSaved(event({ databaseId: 'database-1' }), true),
    ).resolves.toBeUndefined();
    await expect(
      setEventSaved(event({ databaseId: 'database-1' }), false),
    ).resolves.toBeUndefined();
    expect(remove.eq).toHaveBeenCalledTimes(2);

    mockRpc
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, error: null }) as never,
      )
      .mockReturnValueOnce(
        createSupabaseBuilder({
          data: null,
          error: { message: 'ayrılma reddedildi' },
        }) as never,
      )
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, error: null }) as never,
      );
    await expect(joinEvent('database-1')).resolves.toBe('database-1');
    await expect(leaveEvent('database-1')).rejects.toMatchObject({
      message: 'ayrılma reddedildi',
    });
    await expect(leaveEvent('database-2')).resolves.toBe('database-2');
  });
});

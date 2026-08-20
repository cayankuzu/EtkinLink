jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    channel: jest.fn(),
    from: jest.fn(),
    removeChannel: jest.fn(),
    rpc: jest.fn(),
  },
}));
jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));
jest.mock('@shared/lib/ids', () => ({
  createClientId: jest.fn(() => 'request-1'),
}));

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

import { createSupabaseBuilder } from '../../test/supabaseMock';
import {
  changeLikeToPass,
  getMatchContext,
  getMatchingLikeCounts,
  getMatchingSettings,
  getSwipeQuota,
  listCandidates,
  listIncomingLikedCandidates,
  listLikedCandidates,
  setMatchingEnabled,
  subscribeToCandidateChanges,
  swipeCandidate,
} from './matchingService';

const mockRpc = jest.mocked(supabase.rpc);
const mockFrom = jest.mocked(supabase.from);
const mockGetUser = jest.mocked(supabase.auth.getUser);
const mockChannel = jest.mocked(supabase.channel);
const mockRemoveChannel = jest.mocked(supabase.removeChannel);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);

const compatibility = {
  score: 80,
  calculatedAt: '2026-08-19T12:00:00.000Z',
  interests: {
    score: 100,
    commonCount: 1,
    myCount: 1,
    theirCount: 1,
    items: [{ id: 'interest-1', label: 'Müzik' }],
  },
  upcoming: {
    score: 0,
    commonCount: 0,
    myCount: 0,
    theirCount: 0,
    items: [],
  },
  attended: {
    score: 0,
    commonCount: 0,
    myCount: 0,
    theirCount: 0,
    items: [],
  },
};

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-2',
    full_name: 'Deniz',
    username: 'deniz',
    age: 27,
    gender: 'woman',
    bio: 'Müzik sever.',
    city: 'İstanbul',
    joined_at: '2026-08-19T10:00:00.000Z',
    incoming_like: true,
    ...overrides,
  };
}

function quota(overrides: Record<string, unknown> = {}) {
  return {
    windowStartedAt: '2026-08-19T00:00:00.000Z',
    resetAt: '2026-08-19T12:00:00.000Z',
    serverNow: '2026-08-19T06:00:00.000Z',
    likeLimit: 20,
    passLimit: 40,
    usedLikes: 2,
    usedPasses: 3,
    remainingLikes: 18,
    remainingPasses: 37,
    ...overrides,
  };
}

function configureCandidateDependencies(
  rows: Array<Record<string, unknown>>,
  options: { photoError?: { message: string } | null } = {},
) {
  const photos = rows.map((row, index) => ({
    id: `photo-${index}`,
    user_id: row.id,
    storage_path: `${row.id}/photo.jpg`,
    position: 0,
  }));
  const userInterests = rows.map(row => ({
    user_id: row.id,
    interest_id: 'interest-1',
  }));
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'profile_photos') {
      return createSupabaseBuilder({
        data: photos,
        error: options.photoError ?? null,
      });
    }
    if (table === 'user_interests') {
      return createSupabaseBuilder({ data: userInterests, error: null });
    }
    if (table === 'interests') {
      return createSupabaseBuilder({
        data: [
          { id: 'interest-1', slug: 'music', label: 'Müzik', sort_order: 1 },
        ],
        error: null,
      });
    }
    throw new Error(`Beklenmeyen tablo: ${table}`);
  }) as never);
  mockSignedUrls.mockResolvedValue(
    new Map(
      rows.map(row => [
        `${row.id}/photo.jpg`,
        `https://cdn.example/${row.id}.jpg`,
      ]),
    ),
  );
}

describe('matchingService davranış regresyonları', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedUrls.mockResolvedValue(new Map());
  });

  it('adayları fotoğraf, ilgi ve compatibility ile zenginleştirip AbortSignal iletir', async () => {
    const rows = [candidateRow()];
    const candidatesBuilder = createSupabaseBuilder({
      data: rows,
      error: null,
    });
    const compatibilityBuilder = createSupabaseBuilder({
      data: [{ target_user_id: 'user-2', compatibility }],
      error: null,
    });
    mockRpc.mockImplementation(((name: string) => {
      if (name === 'get_event_candidates') return candidatesBuilder;
      if (name === 'get_candidate_compatibilities') return compatibilityBuilder;
      throw new Error(`Beklenmeyen RPC: ${name}`);
    }) as never);
    configureCandidateDependencies(rows);
    const controller = new AbortController();

    const result = await listCandidates('event-1', null, controller.signal);

    expect(result.nextCursor).toBeNull();
    expect(result.items[0]).toMatchObject({
      id: 'user-2',
      photos: [{ url: 'https://cdn.example/user-2.jpg' }],
      interests: [{ label: 'Müzik' }],
      compatibility: { score: 80 },
    });
    expect(candidatesBuilder.abortSignal).toHaveBeenCalledWith(
      controller.signal,
    );
    expect(compatibilityBuilder.abortSignal).toHaveBeenCalledWith(
      controller.signal,
    );
  });

  it('tam aday sayfasında güvenli cursor üretir ve enrichment hatasını gizlemez', async () => {
    const rows = Array.from({ length: 33 }, (_, index) =>
      candidateRow({
        id: `user-${index}`,
        joined_at: `2026-08-19T10:${String(index).padStart(2, '0')}:00.000Z`,
        incoming_like: index % 2 === 0,
      }),
    );
    mockRpc.mockImplementation(((name: string) => {
      if (name === 'get_event_candidates') {
        return createSupabaseBuilder({ data: rows, error: null });
      }
      return createSupabaseBuilder({ data: [], error: null });
    }) as never);
    configureCandidateDependencies(rows, {
      photoError: { message: 'RLS fotoğraf reddi' },
    });

    await expect(listCandidates('event-1')).rejects.toMatchObject({
      message: 'RLS fotoğraf reddi',
    });

    configureCandidateDependencies(rows);
    const page = await listCandidates('event-1');
    expect(page.nextCursor).toEqual({
      incomingLike: true,
      joinedAt: '2026-08-19T10:32:00.000Z',
      userId: 'user-32',
    });
  });

  it('swipe sonucunda match ve quota state transitionını map eder', async () => {
    mockRpc.mockResolvedValue({
      data: { matched: true, match_id: 'match-1', quota: quota() },
      error: null,
    } as never);

    await expect(swipeCandidate('event-1', 'user-2', 'like')).resolves.toEqual({
      matched: true,
      matchId: 'match-1',
      quota: quota(),
    });
    expect(mockRpc).toHaveBeenCalledWith('swipe_event_candidate_v2', {
      target_event_id: 'event-1',
      target_user_id: 'user-2',
      action: 'like',
      request_id: 'request-1',
    });
  });

  it('bozuk quota payloadını reddeder; eksik sayısal alanları güvenli sıfırlar', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: null } as never)
      .mockResolvedValueOnce({
        data: { remainingLikes: Number.NaN },
        error: null,
      } as never);
    await expect(getSwipeQuota()).rejects.toThrow('hakları okunamadı');
    await expect(getSwipeQuota()).resolves.toEqual(
      expect.objectContaining({
        likeLimit: 0,
        remainingLikes: 0,
        resetAt: expect.any(String),
      }),
    );
  });

  it('like sayılarını ve kilit varsayılanını güvenli map eder', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: {
          outgoingCount: 4,
          incomingCount: 2,
          incomingLocked: false,
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: 'bozuk', error: null } as never);
    await expect(getMatchingLikeCounts()).resolves.toEqual({
      outgoingCount: 4,
      incomingCount: 2,
      incomingLocked: false,
    });
    await expect(getMatchingLikeCounts()).resolves.toEqual({
      outgoingCount: 0,
      incomingCount: 0,
      incomingLocked: true,
    });
  });

  it('outgoing ve incoming like listelerini aday bağlamıyla map eder', async () => {
    const row = {
      ...candidateRow(),
      event_id: 'event-1',
      event_title: 'Konser',
      liked_at: '2026-08-19T11:00:00.000Z',
      is_matched: false,
    };
    mockRpc.mockImplementation(((name: string) => {
      if (
        name === 'get_outgoing_event_likes' ||
        name === 'get_incoming_event_likes'
      ) {
        return createSupabaseBuilder({ data: [row], error: null });
      }
      if (name === 'get_candidate_compatibilities') {
        return createSupabaseBuilder({
          data: [{ target_user_id: 'user-2', compatibility }],
          error: null,
        });
      }
      throw new Error(`Beklenmeyen RPC: ${name}`);
    }) as never);
    configureCandidateDependencies([row]);

    await expect(listLikedCandidates()).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({ eventId: 'event-1', matched: false }),
        ],
      }),
    );
    await expect(listIncomingLikedCandidates()).resolves.toEqual(
      expect.objectContaining({ items: [expect.any(Object)] }),
    );
  });

  it('like→pass değişimini ve match context yokluğunu güvenli işler', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { quota: quota() }, error: null } as never)
      .mockResolvedValueOnce({
        data: { malformed: true },
        error: null,
      } as never);
    await expect(changeLikeToPass('event-1', 'user-2')).resolves.toEqual(
      quota(),
    );
    await expect(getMatchContext('user-2')).resolves.toBeNull();
  });

  it('matching ayarını DB profili, etkinlik katılımı ve profil yeterliliğinden üretir', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    } as never);
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          matching_enabled: true,
          bio: 'Yeterince uzun bir biyografi metni.',
        },
      ],
      error: null,
    } as never);
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'event_attendees') {
        return createSupabaseBuilder({
          data: { matching_enabled: false },
          error: null,
        });
      }
      if (table === 'profile_photos') {
        return createSupabaseBuilder({ data: null, count: 3, error: null });
      }
      if (table === 'user_interests') {
        return createSupabaseBuilder({ data: null, count: 3, error: null });
      }
      throw new Error(`Beklenmeyen tablo: ${table}`);
    }) as never);

    await expect(getMatchingSettings('event-1')).resolves.toEqual({
      globalEnabled: true,
      eventEnabled: false,
      premium: false,
      profileReady: true,
      photoCount: 3,
      hasBio: true,
      interestCount: 3,
    });
  });

  it('candidate realtime aboneliğini temizler ve set ayarı hatasını iletir', async () => {
    const channel = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mockChannel.mockReturnValue(channel as never);
    const onChange = jest.fn();
    const unsubscribe = subscribeToCandidateChanges('event-1', onChange);
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ filter: 'event_id=eq.event-1' }),
      onChange,
    );
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);

    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'ayar reddedildi' },
    } as never);
    await expect(setMatchingEnabled(true, 'event-1')).rejects.toMatchObject({
      message: 'ayar reddedildi',
    });
  });
});

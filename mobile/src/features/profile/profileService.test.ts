jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
    rpc: jest.fn(),
    storage: { from: jest.fn() },
  },
}));
jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));
jest.mock('@shared/lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));
jest.mock('@shared/lib/telemetry', () => ({
  captureAppError: jest.fn(),
}));

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';

import { createSupabaseBuilder } from '../../test/supabaseMock';
import {
  getParticipationProfileStatus,
  getProfile,
  listProfileEvents,
  purgeDeletedOwnerPhotoCleanup,
  releaseProfilePhotoCleanupMemory,
  replaceProfilePhotos,
  reportProfilePhoto,
} from './profileService';

const mockGetUser = jest.mocked(supabase.auth.getUser);
const mockFrom = jest.mocked(supabase.from);
const mockRpc = jest.mocked(supabase.rpc);
const mockStorageFrom = jest.mocked(supabase.storage.from);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);
const mockCleanupGetItem = jest.mocked(secureStorage.getItem);
const mockCleanupRemoveItem = jest.mocked(secureStorage.removeItem);
const mockCleanupSetItem = jest.mocked(secureStorage.setItem);
const mockCaptureAppError = jest.mocked(captureAppError);

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    full_name: 'Deniz Kaya',
    username: 'deniz',
    birth_date: '1998-05-10',
    age: null,
    gender: 'woman',
    gender_visibility: 'everyone',
    age_visibility: 'everyone',
    bio: 'Etkinlikleri ve müziği seviyorum.',
    city: 'İstanbul',
    email_verified: true,
    onboarding_completed: true,
    matching_enabled: true,
    ...overrides,
  };
}

function configureAssetTables({
  photos = [],
  photoError = null,
  userInterests = [],
  userInterestError = null,
  interests = [],
  interestError = null,
}: {
  photos?: unknown[];
  photoError?: { message: string } | null;
  userInterests?: unknown[];
  userInterestError?: { message: string } | null;
  interests?: unknown[];
  interestError?: { message: string } | null;
}) {
  mockFrom.mockImplementation(((table: string) => {
    if (table === 'profile_photos') {
      return createSupabaseBuilder({ data: photos, error: photoError });
    }
    if (table === 'user_interests') {
      return createSupabaseBuilder({
        data: userInterests,
        error: userInterestError,
      });
    }
    if (table === 'interests') {
      return createSupabaseBuilder({ data: interests, error: interestError });
    }
    throw new Error(`Beklenmeyen tablo: ${table}`);
  }) as never);
}

describe('profileService güvenlik ve rollback davranışları', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseProfilePhotoCleanupMemory(null);
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.test' } },
      error: null,
    } as never);
    mockSignedUrls.mockResolvedValue(new Map());
    mockCleanupGetItem.mockResolvedValue(null);
    mockCleanupRemoveItem.mockResolvedValue();
    mockCleanupSetItem.mockResolvedValue();
  });

  it('katılım öncesi eksik kimlik, profil, fotoğraf ve ilgi adımlarını açıkça döndürür', async () => {
    mockRpc.mockResolvedValue({
      data: [
        profileRow({
          full_name: ' ',
          username: null,
          birth_date: null,
          gender: null,
          bio: '',
          email_verified: false,
          onboarding_completed: false,
        }),
      ],
      error: null,
    } as never);
    const photoCount = createSupabaseBuilder({
      data: null,
      count: 2,
      error: null,
    });
    const interestCount = createSupabaseBuilder({
      data: null,
      count: 0,
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(photoCount as never)
      .mockReturnValueOnce(interestCount as never);

    const status = await getParticipationProfileStatus();

    expect(status.ready).toBe(false);
    expect(status.missingSteps.map(step => step.id)).toEqual([
      'email',
      'full-name',
      'username',
      'birth-date',
      'gender',
      'bio',
      'photos',
      'interests',
    ]);
    expect(status.missingSteps.at(-2)).toMatchObject({
      destination: 'EditPhotos',
    });
  });

  it('hazır profilin onboarding durumunu atomik tamamlar', async () => {
    mockRpc.mockImplementation(((name: string) => {
      if (name === 'get_my_profile') {
        return Promise.resolve({
          data: [profileRow({ onboarding_completed: false })],
          error: null,
        });
      }
      if (name === 'complete_onboarding') {
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`Beklenmeyen RPC: ${name}`);
    }) as never);
    mockFrom
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, count: 3, error: null }) as never,
      )
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, count: 1, error: null }) as never,
      );

    await expect(getParticipationProfileStatus()).resolves.toEqual({
      ready: true,
      missingSteps: [],
    });
    expect(mockRpc).toHaveBeenCalledWith('complete_onboarding');
  });

  it('oturumsuzluğu ve onboarding completion hatasını güvenli biçimde iletir', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    } as never);
    await expect(getParticipationProfileStatus()).rejects.toThrow(
      'Oturum gerekli.',
    );

    mockRpc.mockImplementation(((name: string) => {
      if (name === 'get_my_profile') {
        return Promise.resolve({
          data: [profileRow({ onboarding_completed: false })],
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: 'durum yazılamadı' },
      });
    }) as never);
    mockFrom
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, count: 3, error: null }) as never,
      )
      .mockReturnValueOnce(
        createSupabaseBuilder({ data: null, count: 1, error: null }) as never,
      );
    await expect(getParticipationProfileStatus()).rejects.toThrow(
      'durum yazılamadı',
    );
  });

  it('kendi profilini fotoğraf ve ilgi alanlarıyla map eder', async () => {
    const ownProfile = profileRow();
    Reflect.deleteProperty(ownProfile, 'age');
    mockRpc.mockResolvedValue({ data: [ownProfile], error: null } as never);
    configureAssetTables({
      photos: [
        {
          id: 'photo-1',
          user_id: 'user-1',
          storage_path: 'user-1/photo.jpg',
          position: 0,
        },
      ],
      userInterests: [{ user_id: 'user-1', interest_id: 'interest-1' }],
      interests: [
        { id: 'interest-1', slug: 'music', label: 'Müzik', sort_order: 1 },
      ],
    });
    mockSignedUrls.mockResolvedValue(
      new Map([['user-1/photo.jpg', 'https://cdn.example/photo.jpg']]),
    );

    const profile = await getProfile();

    expect(mockRpc).toHaveBeenCalledWith('get_my_profile');
    expect(profile).toMatchObject({
      id: 'user-1',
      fullName: 'Deniz Kaya',
      age: expect.any(Number),
      photos: [{ id: 'photo-1', url: 'https://cdn.example/photo.jpg' }],
      interests: [{ id: 'interest-1', label: 'Müzik' }],
    });
  });

  it('başka kullanıcının yardımcı varlık hatasını gizlemez', async () => {
    mockRpc.mockResolvedValue({
      data: [profileRow({ id: 'user-2', age: 27, birth_date: null })],
      error: null,
    } as never);
    configureAssetTables({ photoError: { message: 'RLS reddetti' } });

    await expect(getProfile('user-2')).rejects.toMatchObject({
      message: 'RLS reddetti',
    });
    expect(mockRpc).toHaveBeenCalledWith('get_profile_view', {
      target_profile_id: 'user-2',
    });
  });

  it('kendi profilinde yardımcı veri ve signed URL hatasında temel profili korur', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    mockRpc.mockResolvedValue({ data: [profileRow()], error: null } as never);
    configureAssetTables({ photoError: { message: 'geçici hata' } });
    mockSignedUrls.mockRejectedValue(new Error('imza kapalı'));

    await expect(getProfile()).resolves.toMatchObject({
      id: 'user-1',
      photos: [],
      interests: [],
    });
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it('profil etkinliklerini map eder ve fotoğraf raporunu doğru bağlamla gönderir', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [
          {
            id: 'event-1',
            title: 'Konser',
            start_at: '2026-09-01T18:00:00.000Z',
            venue: 'Salon',
            city: 'İstanbul',
            image_url: null,
            categories: ['Müzik'],
          },
        ],
        error: null,
      } as never)
      .mockResolvedValueOnce({ data: null, error: null } as never);

    await expect(listProfileEvents('user-2', 'upcoming', 20)).resolves.toEqual([
      expect.objectContaining({ id: 'event-1', joined: true }),
    ]);
    await expect(
      reportProfilePhoto(
        'user-2',
        'event-1',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenLastCalledWith(
      'submit_report',
      expect.objectContaining({
        target_user_id: 'user-2',
        target_event_id: 'event-1',
        block_after: false,
        client_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
  });

  it('fotoğraf sayısı sınırını veritabanına gitmeden uygular', async () => {
    await expect(replaceProfilePhotos([])).rejects.toThrow(
      'En az 3, en fazla 6',
    );
    await expect(
      replaceProfilePhotos(
        Array.from({ length: 7 }, (_, index) => ({
          kind: 'existing' as const,
          storagePath: `user-1/${index}.jpg`,
        })),
      ),
    ).rejects.toThrow('En az 3, en fazla 6');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('yeni fotoğrafları yükler, atomik değiştirir ve artık kullanılmayanı siler', async () => {
    const bucket = {
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockRpc.mockResolvedValue({
      data: ['user-1/legacy/nested.jpg'],
      error: null,
    } as never);

    await replaceProfilePhotos([
      { kind: 'existing', storagePath: 'user-1/keep.jpg' },
      {
        kind: 'new',
        base64: '/9j/2Q==',
        mimeType: 'image/jpeg',
        extension: 'jpg',
      },
      {
        kind: 'new',
        base64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        extension: 'png',
      },
    ]);

    expect(bucket.upload).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith(
      'replace_profile_photos',
      expect.objectContaining({ storage_paths: expect.any(Array) }),
    );
    expect(bucket.remove).toHaveBeenCalledWith(['user-1/legacy/nested.jpg']);
  });

  it('yükleme sonrası atomik replace başarısızsa yalnız yeni dosyaları temizler', async () => {
    const bucket = {
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'replace reddedildi' },
    } as never);

    await expect(
      replaceProfilePhotos([
        { kind: 'existing', storagePath: 'user-1/keep.jpg' },
        {
          kind: 'new',
          base64: '/9j/2Q==',
          mimeType: 'image/jpeg',
          extension: 'jpg',
        },
        {
          kind: 'new',
          base64: '/9j/2Q==',
          mimeType: 'image/jpeg',
          extension: 'jpg',
        },
      ]),
    ).rejects.toMatchObject({ message: 'replace reddedildi' });
    const cleanup = bucket.remove.mock.calls.at(-1)?.[0] as string[];
    expect(cleanup).toHaveLength(2);
    expect(cleanup).not.toContain('user-1/keep.jpg');
  });

  it('commit sonrası nesne silme hatasını kalıcı kuyruğa alır ve başarılı replace sonucunu bozmaz', async () => {
    const cleanupError = new Error('storage temporarily unavailable');
    const bucket = {
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: cleanupError }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockRpc.mockResolvedValue({
      data: ['user-1/legacy/nested.jpg'],
      error: null,
    } as never);

    await expect(
      replaceProfilePhotos([
        { kind: 'existing', storagePath: 'user-1/one.jpg' },
        { kind: 'existing', storagePath: 'user-1/two.jpg' },
        { kind: 'existing', storagePath: 'user-1/three.jpg' },
      ]),
    ).resolves.toBeUndefined();

    expect(bucket.remove).toHaveBeenCalledTimes(2);
    expect(mockCleanupSetItem).toHaveBeenCalledWith(
      'profile-photo-cleanup-v1.user-1',
      JSON.stringify({
        version: 1,
        ownerId: 'user-1',
        paths: ['user-1/legacy/nested.jpg'],
      }),
    );
    expect(mockCleanupRemoveItem).not.toHaveBeenCalled();
    expect(mockCleanupSetItem.mock.invocationCallOrder[0]).toBeLessThan(
      bucket.remove.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('kalici temizlik kuyrugunu yeniden yukler ve yalniz guvenli owner yollarini siler', async () => {
    const validPath = 'USER-1/legacy/nested.jpg';
    mockCleanupGetItem.mockResolvedValue(
      JSON.stringify({
        version: 1,
        ownerId: 'user-1',
        paths: [
          validPath,
          'user-2/foreign.jpg',
          'user-1',
          'user-1/',
          'user-1/../escape.jpg',
          'user-1/./same.jpg',
          'user-1\\unsafe.jpg',
          'user-1/\u0001control.jpg',
          `user-1/${'x'.repeat(1_025)}`,
          42,
        ],
      }),
    );
    const bucket = {
      remove: jest.fn().mockResolvedValue({ error: null }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockRpc.mockResolvedValue({ data: [profileRow()], error: null } as never);
    configureAssetTables({});

    await expect(getProfile()).resolves.toMatchObject({ id: 'user-1' });

    expect(bucket.remove).toHaveBeenCalledWith([validPath]);
    expect(mockCleanupRemoveItem).toHaveBeenCalledWith(
      'profile-photo-cleanup-v1.user-1',
    );
  });

  it('bozuk veya gecersiz kalici temizlik kaydini guvenle toparlar', async () => {
    mockCleanupGetItem
      .mockResolvedValueOnce('{broken-json')
      .mockResolvedValueOnce(
        JSON.stringify({ version: 2, ownerId: 'user-1', paths: [] }),
      );
    mockRpc.mockResolvedValue({ data: [profileRow()], error: null } as never);
    configureAssetTables({});

    await expect(getProfile()).resolves.toMatchObject({ id: 'user-1' });
    await expect(getProfile()).resolves.toMatchObject({ id: 'user-1' });

    expect(mockCaptureAppError).toHaveBeenCalledWith(expect.any(SyntaxError), {
      operation: 'profile.photo_cleanup_read',
    });
    expect(mockCleanupRemoveItem).toHaveBeenCalledWith(
      'profile-photo-cleanup-v1.user-1',
    );
  });

  it('profil oturum ve RPC hatalarini baglamiyla iletir', async () => {
    const authError = new Error('session expired');
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: authError,
    } as never);
    await expect(getProfile()).rejects.toBe(authError);

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'profile unavailable' },
    } as never);
    await expect(getProfile()).rejects.toThrow(
      'Profil bilgileri: profile unavailable',
    );
  });

  it('kuyruk persist ve acknowledgement hatalarinda commit sonucunu korur', async () => {
    const bucket = {
      remove: jest.fn().mockResolvedValue({ error: null }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockCleanupSetItem.mockRejectedValueOnce(new Error('persist unavailable'));
    mockCleanupRemoveItem.mockRejectedValueOnce(new Error('ack unavailable'));
    mockRpc.mockResolvedValue({
      data: ['user-1/old.jpg'],
      error: null,
    } as never);

    await expect(
      replaceProfilePhotos([
        { kind: 'existing', storagePath: 'user-1/one.jpg' },
        { kind: 'existing', storagePath: 'user-1/two.jpg' },
        { kind: 'existing', storagePath: 'user-1/three.jpg' },
      ]),
    ).resolves.toBeUndefined();

    expect(bucket.remove).toHaveBeenCalledWith(['user-1/old.jpg']);
    expect(mockCaptureAppError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'profile.photo_cleanup_persist',
    });
    expect(mockCaptureAppError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'profile.photo_cleanup_ack',
    });
  });

  it('baska owner veya nested mevcut fotograf yolunu replace icin reddeder', async () => {
    const validPhotos = [
      { kind: 'existing' as const, storagePath: 'user-1/one.jpg' },
      { kind: 'existing' as const, storagePath: 'user-1/two.jpg' },
    ];

    await expect(
      replaceProfilePhotos([
        { kind: 'existing', storagePath: 'user-2/foreign.jpg' },
        ...validPhotos,
      ]),
    ).rejects.toThrow('Profil');
    await expect(
      replaceProfilePhotos([
        { kind: 'existing', storagePath: 'user-1/legacy/nested.jpg' },
        ...validPhotos,
      ]),
    ).rejects.toThrow('Profil');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('aktif cleanup kilidinde RAM state release eder ve silinen owner kaydini purge eder', async () => {
    mockCleanupGetItem.mockResolvedValue(
      JSON.stringify({
        version: 1,
        ownerId: 'user-1',
        paths: ['user-1/stale.jpg'],
      }),
    );
    let released = false;
    const bucket = {
      remove: jest.fn().mockImplementation(async () => {
        if (!released) {
          released = true;
          releaseProfilePhotoCleanupMemory('user-1');
          releaseProfilePhotoCleanupMemory(null);
        }
        return { error: null };
      }),
    };
    mockStorageFrom.mockReturnValue(bucket as never);
    mockRpc.mockResolvedValue({ data: [profileRow()], error: null } as never);
    configureAssetTables({});

    await expect(getProfile()).resolves.toMatchObject({ id: 'user-1' });
    await Promise.resolve();
    await purgeDeletedOwnerPhotoCleanup('user-1');

    expect(released).toBe(true);
    expect(mockCleanupRemoveItem).toHaveBeenCalledWith(
      'profile-photo-cleanup-v1.user-1',
    );
  });

  it('cleanup gozlemi beklenmedik bicimde firlatsa da kilit rejection yolunu sonlandirir', async () => {
    const telemetryError = new Error('telemetry threw');
    mockCleanupGetItem.mockRejectedValueOnce(new Error('secure read failed'));
    mockCaptureAppError.mockImplementationOnce(() => {
      throw telemetryError;
    });

    await expect(getProfile()).rejects.toBe(telemetryError);
    await Promise.resolve();
  });
});

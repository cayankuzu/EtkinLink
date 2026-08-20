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

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

import { createSupabaseBuilder } from '../../test/supabaseMock';
import {
  getParticipationProfileStatus,
  getProfile,
  listProfileEvents,
  replaceProfilePhotos,
  reportProfilePhoto,
} from './profileService';

const mockGetUser = jest.mocked(supabase.auth.getUser);
const mockFrom = jest.mocked(supabase.from);
const mockRpc = jest.mocked(supabase.rpc);
const mockStorageFrom = jest.mocked(supabase.storage.from);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);

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
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'user@example.test' } },
      error: null,
    } as never);
    mockSignedUrls.mockResolvedValue(new Map());
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
      reportProfilePhoto('user-2', 'event-1'),
    ).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenLastCalledWith(
      'submit_report',
      expect.objectContaining({
        target_user_id: 'user-2',
        target_event_id: 'event-1',
        block_after: false,
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
      data: ['user-1/old.jpg'],
      error: null,
    } as never);

    await replaceProfilePhotos([
      { kind: 'existing', storagePath: 'user-1/keep.jpg' },
      {
        kind: 'new',
        base64: 'AQID',
        mimeType: 'image/jpeg',
        extension: 'jpg',
      },
      {
        kind: 'new',
        base64: 'AQID',
        mimeType: 'image/png',
        extension: 'png',
      },
    ]);

    expect(bucket.upload).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith(
      'replace_profile_photos',
      expect.objectContaining({ storage_paths: expect.any(Array) }),
    );
    expect(bucket.remove).toHaveBeenCalledWith(['user-1/old.jpg']);
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
          base64: 'AQID',
          mimeType: 'image/jpeg',
          extension: 'jpg',
        },
        {
          kind: 'new',
          base64: 'AQID',
          mimeType: 'image/jpeg',
          extension: 'jpg',
        },
      ]),
    ).rejects.toMatchObject({ message: 'replace reddedildi' });
    const cleanup = bucket.remove.mock.calls.at(-1)?.[0] as string[];
    expect(cleanup).toHaveLength(2);
    expect(cleanup).not.toContain('user-1/keep.jpg');
  });
});

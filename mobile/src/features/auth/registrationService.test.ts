jest.mock('@shared/lib/ids', () => ({
  createClientId: jest.fn(),
}));

jest.mock('@shared/lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    rpc: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

import { createClientId } from '@shared/lib/ids';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';

import { useRegistrationDraftStore } from './registrationDraftStore';
import {
  clearPendingRegistration,
  finalizePendingRegistration,
  listRegistrationInterests,
  persistPendingRegistration,
} from './registrationService';

const mockCreateClientId = jest.mocked(createClientId);
const mockGetItem = jest.mocked(secureStorage.getItem);
const mockRemoveItem = jest.mocked(secureStorage.removeItem);
const mockSetItem = jest.mocked(secureStorage.setItem);
const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;
const mockStorageFrom = supabase.storage.from as jest.Mock;

const photos = [0, 1, 2].map(index => ({
  id: `photo-${index}`,
  uri: `file:///photo-${index}.jpg`,
  base64: '/9j/2Q==',
  mimeType: 'image/jpeg',
  extension: 'jpg' as const,
}));

function setSubmittedDraft() {
  const store = useRegistrationDraftStore.getState();
  store.setCredentials(' Deniz@Example.com ', 'secret-password');
  store.setPhotos(photos);
  store.markSubmitted();
}

function setupSuccessfulStorage() {
  const upload = jest.fn().mockResolvedValue({ error: null });
  const remove = jest.fn().mockResolvedValue({ error: null });
  mockStorageFrom.mockReturnValue({ upload, remove });
  mockGetUser.mockResolvedValue({
    data: {
      user: { id: 'user-1', email: 'deniz@example.com' },
    },
    error: null,
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockCreateClientId
    .mockReturnValueOnce('client-1')
    .mockReturnValueOnce('client-2')
    .mockReturnValueOnce('client-3');
  return { upload, remove };
}

describe('registrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClientId.mockReset();
    useRegistrationDraftStore.getState().reset();
    mockGetItem.mockResolvedValue(null);
    mockRemoveItem.mockResolvedValue();
    mockSetItem.mockResolvedValue();
  });

  it('kaydın kullanabileceği aktif ilgi alanlarını alan modeline dönüştürür', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: 'interest-1', slug: 'music', label: 'Müzik', sort_order: 4 },
      ],
      error: null,
    });

    await expect(listRegistrationInterests()).resolves.toEqual([
      { id: 'interest-1', slug: 'music', label: 'Müzik', sortOrder: 4 },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('get_registration_interests');

    const error = new Error('interests denied');
    mockRpc.mockResolvedValueOnce({ data: null, error });
    await expect(listRegistrationInterests()).rejects.toBe(error);
  });

  it('bekleyen kayıtta parolayı ve fotoğraf base64 verisini saklamaz', async () => {
    setSubmittedDraft();

    await persistPendingRegistration();

    expect(mockSetItem).toHaveBeenCalledWith(
      'registration.pending-profile',
      JSON.stringify({
        email: 'deniz@example.com',
        photos: photos.map(({ base64: _base64, ...photo }) => photo),
      }),
    );
    await clearPendingRegistration();
    expect(mockRemoveItem).toHaveBeenCalledWith('registration.pending-profile');
  });

  it('tamamlanabilir taslak yoksa ağ veya depolama yazımı yapmaz', async () => {
    await expect(finalizePendingRegistration()).resolves.toBe(false);

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('bozuk kalıcı taslağı temizler ve finalizasyonu reddeder', async () => {
    mockGetItem.mockResolvedValue('{not-json');

    await expect(finalizePendingRegistration()).resolves.toBe(false);

    expect(mockRemoveItem).toHaveBeenCalledWith('registration.pending-profile');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('fotoğrafları yükler, atomik değiştirir ve ancak başarıdan sonra taslağı temizler', async () => {
    setSubmittedDraft();
    const { upload, remove } = setupSuccessfulStorage();

    await expect(finalizePendingRegistration()).resolves.toBe(true);

    expect(upload.mock.calls.map(call => call[0])).toEqual([
      'user-1/client-1.jpg',
      'user-1/client-2.jpg',
      'user-1/client-3.jpg',
    ]);
    expect(mockRpc).toHaveBeenCalledWith('replace_profile_photos', {
      storage_paths: [
        'user-1/client-1.jpg',
        'user-1/client-2.jpg',
        'user-1/client-3.jpg',
      ],
    });
    expect(remove).not.toHaveBeenCalled();
    expect(useRegistrationDraftStore.getState()).toMatchObject({
      email: '',
      password: '',
      photos: [],
      submitted: false,
    });
    expect(mockRemoveItem).toHaveBeenCalledWith('registration.pending-profile');
  });

  it('veritabanı commitinden sonraki taslak temizleme hatasında yüklenen fotoğrafları silmez', async () => {
    setSubmittedDraft();
    const { remove } = setupSuccessfulStorage();
    mockRemoveItem.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(finalizePendingRegistration()).resolves.toBe(true);

    expect(mockRpc).toHaveBeenCalledWith('replace_profile_photos', {
      storage_paths: [
        'user-1/client-1.jpg',
        'user-1/client-2.jpg',
        'user-1/client-3.jpg',
      ],
    });
    expect(remove).not.toHaveBeenCalled();
    expect(useRegistrationDraftStore.getState().submitted).toBe(false);
  });

  it('aynı anda gelen finalizasyonları tek yükleme işleminde birleştirir', async () => {
    setSubmittedDraft();
    const { upload } = setupSuccessfulStorage();

    const [first, second] = await Promise.all([
      finalizePendingRegistration(),
      finalizePendingRegistration(),
    ]);

    expect([first, second]).toEqual([true, true]);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('oturum e-postası bekleyen kayda ait değilse başarı raporlamaz veya veri yazmaz', async () => {
    setSubmittedDraft();
    const { upload } = setupSuccessfulStorage();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-2', email: 'başka@example.com' } },
      error: null,
    });

    await expect(finalizePendingRegistration()).resolves.toBe(false);

    expect(upload).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('yükleme veya profil değiştirme hatasında yalnızca bu denemede yüklenen dosyaları geri alır', async () => {
    setSubmittedDraft();
    const { upload, remove } = setupSuccessfulStorage();
    const error = new Error('second upload failed');
    upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error });

    await expect(finalizePendingRegistration()).rejects.toBe(error);

    expect(remove).toHaveBeenCalledWith(['user-1/client-1.jpg']);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(useRegistrationDraftStore.getState().submitted).toBe(true);
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('kimlik doğrulama hatasını yutmadan yarım başarı üretmez', async () => {
    setSubmittedDraft();
    const error = new Error('session expired');
    mockGetUser.mockResolvedValue({ data: { user: null }, error });

    await expect(finalizePendingRegistration()).rejects.toBe(error);

    expect(mockStorageFrom).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('kalici taslaktaki URI fotograflarini okuyup dogrular', async () => {
    const persistedPhotos = photos.map(
      ({ base64: _base64, ...photo }) => photo,
    );
    mockGetItem.mockResolvedValue(
      JSON.stringify({ email: 'deniz@example.com', photos: persistedPhotos }),
    );
    const { upload } = setupSuccessfulStorage();
    const arrayBuffer = jest
      .fn()
      .mockResolvedValue(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ arrayBuffer } as unknown as Response);

    await expect(finalizePendingRegistration()).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(arrayBuffer).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(3);
    fetchSpy.mockRestore();
  });

  it('rollback depolama temizligi de basarisizsa bilesik hata dondurur', async () => {
    setSubmittedDraft();
    const { upload, remove } = setupSuccessfulStorage();
    const uploadError = new Error('second upload failed');
    const cleanupError = new Error('cleanup failed');
    upload
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: uploadError });
    remove.mockResolvedValueOnce({ error: cleanupError });

    await expect(finalizePendingRegistration()).rejects.toMatchObject({
      code: 'unavailable',
      cause: { operationError: uploadError, cleanupError },
    });
    expect(remove).toHaveBeenCalledWith(['user-1/client-1.jpg']);
  });
});

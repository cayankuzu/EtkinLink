import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@shared/lib/supabase';

import {
  accountDeletionErrorMessage,
  deleteOwnAccount,
} from './accountDeletionService';
import { purgeDeletedOwnerPhotoCleanup } from './profileService';

jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
  },
}));
jest.mock('./profileService', () => ({
  purgeDeletedOwnerPhotoCleanup: jest.fn(),
}));

const userId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const invoke = jest.mocked(supabase.functions.invoke);
const getItem = jest.mocked(AsyncStorage.getItem);
const setItem = jest.mocked(AsyncStorage.setItem);
const removeItem = jest.mocked(AsyncStorage.removeItem);
const purgePhotoCleanup = jest.mocked(purgeDeletedOwnerPhotoCleanup);

describe('accountDeletionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getItem.mockResolvedValue(requestId);
    purgePhotoCleanup.mockResolvedValue();
    invoke.mockImplementation(async (_functionName, options) => ({
      data: {
        client_request_id: (options?.body as { client_request_id?: string })
          ?.client_request_id,
        deleted: true,
        phase: 'completed',
      },
      error: null,
    }));
  });

  it('kalıcı istek kimliğini strict JSON gövdesinde yeniden kullanır', async () => {
    await deleteOwnAccount(userId);

    expect(setItem).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('delete-account', {
      method: 'POST',
      body: { client_request_id: requestId },
    });
    expect(removeItem).toHaveBeenCalledWith(
      `@etkinlink/account-deletion-request-v1/${userId}`,
    );
    expect(purgePhotoCleanup).toHaveBeenCalledWith(userId);
  });

  it('sunucu hatasında aynı istek kimliğini sonraki deneme için korur', async () => {
    const error = Object.assign(new Error('backend detail'), {
      context: new Response(null, { status: 503 }),
    });
    invoke.mockResolvedValueOnce({ data: null, error });

    await expect(deleteOwnAccount(userId)).rejects.toBe(error);
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('202 resumable yanıtını aynı kimlikle sürdürüp yalnız tamamlanınca temizler', async () => {
    invoke
      .mockResolvedValueOnce({
        data: {
          client_request_id: requestId,
          deleted: false,
          phase: 'storage_deleting',
          resumable: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          client_request_id: requestId,
          deleted: true,
          phase: 'completed',
        },
        error: null,
      });

    await deleteOwnAccount(userId);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[1]).toEqual(invoke.mock.calls[1]?.[1]);
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it('malformed başarı yanıtını tamamlanmış saymaz ve kimliği korur', async () => {
    invoke.mockResolvedValueOnce({ data: { deleted: true }, error: null });

    await expect(deleteOwnAccount(userId)).rejects.toThrow(
      'Hesap silme işlemi henüz tamamlanamadı.',
    );
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('eksik veya bozuk kimliği çağrıdan önce UUID olarak kalıcılaştırır', async () => {
    getItem.mockResolvedValueOnce('broken');

    await deleteOwnAccount(userId);

    const generated = setItem.mock.calls[0]?.[1];
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(invoke).toHaveBeenCalledWith(
      'delete-account',
      expect.objectContaining({
        body: { client_request_id: generated },
      }),
    );
  });

  it('backend metnini göstermeden güvenli ve eyleme dönük hata üretir', () => {
    const forbidden = Object.assign(new Error('sensitive backend detail'), {
      context: new Response(null, { status: 403 }),
    });
    const unavailable = Object.assign(new Error('sensitive backend detail'), {
      context: new Response(null, { status: 503 }),
    });

    expect(accountDeletionErrorMessage(forbidden)).toBe(
      'Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.',
    );
    expect(accountDeletionErrorMessage(unavailable)).toBe(
      'Hizmet geçici olarak kullanılamıyor. Lütfen tekrar dene.',
    );
  });
});

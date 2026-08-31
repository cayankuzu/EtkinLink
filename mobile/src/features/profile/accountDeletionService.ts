import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppError, toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { supabase } from '@shared/lib/supabase';

import { purgeDeletedOwnerPhotoCleanup } from './profileService';

const REQUEST_KEY_PREFIX = '@etkinlink/account-deletion-request-v1/';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTINUATION_CALLS = 3;

function storageKey(userId: string): string {
  if (!UUID_PATTERN.test(userId)) {
    throw new AppError(
      'unauthorized',
      'Oturumun sona erdi. Lütfen yeniden giriş yap.',
    );
  }
  return `${REQUEST_KEY_PREFIX}${userId}`;
}

async function getOrCreateRequestId(userId: string): Promise<string> {
  const key = storageKey(userId);
  const stored = await AsyncStorage.getItem(key);
  if (stored && UUID_PATTERN.test(stored)) return stored;

  const requestId = createClientId();
  if (!UUID_PATTERN.test(requestId)) {
    throw new AppError(
      'configuration',
      'Hesap silme isteği güvenli biçimde başlatılamadı.',
    );
  }
  await AsyncStorage.setItem(key, requestId);
  return requestId;
}

export async function deleteOwnAccount(userId: string): Promise<void> {
  const key = storageKey(userId);
  const clientRequestId = await getOrCreateRequestId(userId);
  for (let attempt = 0; attempt < MAX_CONTINUATION_CALLS; attempt += 1) {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      method: 'POST',
      body: { client_request_id: clientRequestId },
    });
    if (error) throw error;

    if (
      data &&
      typeof data === 'object' &&
      data.client_request_id === clientRequestId &&
      data.deleted === true &&
      data.phase === 'completed'
    ) {
      // The server-side deletion already succeeded; a local cleanup failure
      // must never keep a deleted account looking signed in.
      await Promise.all([
        AsyncStorage.removeItem(key).catch(() => undefined),
        purgeDeletedOwnerPhotoCleanup(userId).catch(() => undefined),
      ]);
      return;
    }

    const resumable =
      data &&
      typeof data === 'object' &&
      data.client_request_id === clientRequestId &&
      data.deleted === false &&
      data.phase === 'storage_deleting' &&
      data.resumable === true;
    if (!resumable) break;
  }

  throw new AppError(
    'unavailable',
    'Hesap silme işlemi henüz tamamlanamadı. Aynı isteği yeniden dene.',
  );
}

export function accountDeletionErrorMessage(error: unknown): string {
  const normalized = toAppError(error);
  if (normalized.code === 'forbidden') {
    return 'Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.';
  }
  return normalized.message;
}

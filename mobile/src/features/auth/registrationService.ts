import { AppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { assertValidProfilePhoto } from '@shared/lib/profilePhotoValidation';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import type { Interest } from '@shared/types/domain';
import { decode } from 'base64-arraybuffer';

import {
  getRegistrationDraft,
  useRegistrationDraftStore,
} from './registrationDraftStore';

const pendingRegistrationKey = 'registration.pending-profile';
let finalizationPromise: Promise<boolean> | null = null;

type PendingPhoto = {
  id: string;
  uri: string;
  base64?: string;
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp' | 'heic' | 'heif';
};

type PendingRegistration = {
  email: string;
  photos: PendingPhoto[];
};

export async function listRegistrationInterests(): Promise<Interest[]> {
  const { data, error } = await supabase.rpc('get_registration_interests');
  if (error) throw error;
  return data.map(item => ({
    id: item.id,
    slug: item.slug,
    label: item.label,
    sortOrder: item.sort_order,
  }));
}

export async function persistPendingRegistration(): Promise<void> {
  const draft = getRegistrationDraft();
  const pending: PendingRegistration = {
    email: draft.email,
    photos: draft.photos.map(photo => ({
      id: photo.id,
      uri: photo.uri,
      mimeType: photo.mimeType,
      extension: photo.extension,
    })),
  };
  await secureStorage.setItem(pendingRegistrationKey, JSON.stringify(pending));
}

export async function clearPendingRegistration(): Promise<void> {
  await secureStorage.removeItem(pendingRegistrationKey);
}

export async function finalizePendingRegistration(): Promise<boolean> {
  if (finalizationPromise) return finalizationPromise;
  finalizationPromise = (async () => {
    const draft = getRegistrationDraft();
    const persisted = await readPersistedRegistration();
    const pending: PendingRegistration | null =
      draft.submitted && draft.photos.length >= 3
        ? { email: draft.email, photos: draft.photos }
        : persisted;
    if (!pending || pending.photos.length < 3) return false;
    return finalizeDraft(pending);
  })().finally(() => {
    finalizationPromise = null;
  });
  return finalizationPromise;
}

async function readPersistedRegistration(): Promise<PendingRegistration | null> {
  const raw = await secureStorage.getItem(pendingRegistrationKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    await clearPendingRegistration();
    return null;
  }
}

async function finalizeDraft(pending: PendingRegistration): Promise<boolean> {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (
    data.user.email?.trim().toLocaleLowerCase('tr-TR') !==
    pending.email.trim().toLocaleLowerCase('tr-TR')
  ) {
    return false;
  }

  const uploadedPaths: string[] = [];
  try {
    for (const photo of pending.photos) {
      const path = `${data.user.id}/${createClientId()}.${photo.extension}`;
      const fileData = photo.base64
        ? decode(photo.base64)
        : await fetch(photo.uri).then(response => response.arrayBuffer());
      assertValidProfilePhoto(fileData, photo.mimeType, photo.extension);
      const { error } = await supabase.storage
        .from('profile-photos')
        .upload(path, fileData, {
          contentType: photo.mimeType,
          upsert: false,
          cacheControl: '0',
        });
      if (error) throw error;
      uploadedPaths.push(path);
    }

    const { error: photosError } = await supabase.rpc(
      'replace_profile_photos',
      { storage_paths: uploadedPaths },
    );
    if (photosError) throw photosError;
  } catch (operationError) {
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from('profile-photos')
        .remove(uploadedPaths);
      if (cleanupError) {
        throw new AppError(
          'unavailable',
          'Kayıt tamamlanamadı ve geçici fotoğraflar temizlenemedi.',
          { operationError, cleanupError },
        );
      }
    }
    throw operationError;
  }

  // The database now references uploadedPaths. Local draft cleanup must never
  // enter the pre-commit rollback branch and delete those committed objects.
  useRegistrationDraftStore.getState().reset();
  try {
    await clearPendingRegistration();
  } catch (cleanupError) {
    captureAppError(cleanupError, {
      operation: 'registration.committed_draft_cleanup',
    });
  }
  return true;
}

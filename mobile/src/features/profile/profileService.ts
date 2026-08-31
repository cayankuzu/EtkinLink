import { paginationLimits } from '@shared/constants/limits';
import { createClientId } from '@shared/lib/ids';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import {
  assertValidProfilePhoto,
  type ProfilePhotoExtension,
} from '@shared/lib/profilePhotoValidation';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import type {
  Event,
  Interest,
  Profile,
  ProfilePhoto,
} from '@shared/types/domain';
import { decode } from 'base64-arraybuffer';
import { differenceInYears } from 'date-fns';

export type ParticipationProfileDestination =
  | 'EditProfile'
  | 'EditPhotos'
  | 'EditInterests';

type ParticipationProfileStep = {
  id: string;
  label: string;
  destination: ParticipationProfileDestination;
};

export type ParticipationProfileStatus = {
  ready: boolean;
  missingSteps: ParticipationProfileStep[];
};

/** Mirrors the requirements enforced by the database before joining an event. */
export async function getParticipationProfileStatus(): Promise<ParticipationProfileStatus> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw authError ?? new Error('Oturum gerekli.');
  }
  const userId = authData.user.id;
  const [profileResult, photoResult, interestResult] = await Promise.all([
    supabase.rpc('get_my_profile'),
    supabase
      .from('profile_photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('user_interests')
      .select('interest_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);
  const requestError =
    profileResult.error ?? photoResult.error ?? interestResult.error;
  if (requestError) throw requestError;
  const profile = profileResult.data?.find(item => item.id === userId);
  if (!profile) throw new Error('Profil bulunamadı.');

  const photoCount = photoResult.count ?? 0;
  const interestCount = interestResult.count ?? 0;
  const missingSteps: ParticipationProfileStep[] = [];
  const addProfileStep = (id: string, label: string) =>
    missingSteps.push({ id, label, destination: 'EditProfile' });

  if (!profile.email_verified) {
    addProfileStep('email', 'E-posta adresini doğrula');
  }
  if (!profile.full_name?.trim()) {
    addProfileStep('full-name', 'Ad ve soyadını ekle');
  }
  if (!profile.username?.trim()) {
    addProfileStep('username', 'Kullanıcı adını belirle');
  }
  if (!profile.birth_date) {
    addProfileStep('birth-date', 'Doğum tarihini ekle');
  }
  if (!profile.gender) {
    addProfileStep('gender', 'Cinsiyet seçimini tamamla');
  }
  if (!profile.bio?.trim()) {
    addProfileStep('bio', 'Kısa bir biyografi yaz');
  }
  if (photoCount < 3) {
    missingSteps.push({
      id: 'photos',
      label: `En az 3 profil fotoğrafı ekle (${photoCount}/3)`,
      destination: 'EditPhotos',
    });
  }
  if (interestCount < 1) {
    missingSteps.push({
      id: 'interests',
      label: 'En az 1 ilgi alanı seç (0/1)',
      destination: 'EditInterests',
    });
  }
  if (!profile.onboarding_completed && missingSteps.length === 0) {
    const { error: completionError } = await supabase.rpc(
      'complete_onboarding',
    );
    if (completionError) {
      throw new Error(
        `Profilin tamamlandı ancak katılım durumu güncellenemedi: ${completionError.message}`,
      );
    }
  }

  return { ready: missingSteps.length === 0, missingSteps };
}

export async function getProfile(userId?: string): Promise<Profile> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user)
    throw authError ?? new Error('Oturum gerekli.');
  await retryPendingProfilePhotoCleanup(authData.user.id);
  const profileId = userId ?? authData.user.id;
  const profileRequest =
    profileId === authData.user.id
      ? supabase.rpc('get_my_profile')
      : supabase.rpc('get_profile_view', { target_profile_id: profileId });
  const { data: profileRows, error: profileError } = await profileRequest;
  if (profileError) {
    throw new Error(`Profil bilgileri: ${profileError.message}`);
  }
  const [photosResult, userInterestsResult] = await Promise.all([
    supabase
      .from('profile_photos')
      .select('*')
      .eq('user_id', profileId)
      .order('position'),
    supabase.from('user_interests').select('*').eq('user_id', profileId),
  ]);
  const assetError = photosResult.error ?? userInterestsResult.error;
  const ownProfile = profileId === authData.user.id;
  if (assetError && !ownProfile) throw assetError;
  if (assetError) {
    console.warn('Profil yardımcı bilgileri yüklenemedi.', assetError.message);
  }
  const photos = photosResult.data ?? [];
  const userInterests = userInterestsResult.data ?? [];
  const profile = profileRows[0];
  if (!profile) throw new Error('Profil bulunamadı.');
  let signedUrls = new Map<string, string>();
  try {
    signedUrls = await getSignedProfilePhotoUrls(
      photos.map(photo => photo.storage_path),
    );
  } catch (error) {
    if (!ownProfile) throw error;
    console.warn('Profil fotoğrafları imzalanamadı.', error);
  }
  const interestIds = userInterests.map(row => row.interest_id);
  const { data: interests, error: interestsError } = interestIds.length
    ? await supabase
        .from('interests')
        .select('id,slug,label,sort_order')
        .in('id', interestIds)
        .order('sort_order')
    : { data: [], error: null };
  if (interestsError) throw interestsError;
  const age =
    'age' in profile
      ? profile.age
      : profile.birth_date
      ? differenceInYears(new Date(), new Date(profile.birth_date))
      : null;
  return {
    id: profile.id,
    fullName: profile.full_name ?? 'EtkinLink kullanıcısı',
    username: profile.username ?? 'kullanici',
    birthDate: profile.birth_date,
    age,
    gender: profile.gender,
    genderVisibility:
      profile.gender_visibility ?? (profile.gender ? 'everyone' : 'hidden'),
    ageVisibility:
      profile.age_visibility ?? (profile.age !== null ? 'everyone' : 'hidden'),
    bio: profile.bio ?? '',
    city: profile.city ?? '',
    emailVerified: profile.email_verified,
    onboardingCompleted: profile.onboarding_completed,
    matchingEnabled: profile.matching_enabled,
    photos: photos.flatMap(photo => {
      const url = signedUrls.get(photo.storage_path);
      return url
        ? [
            {
              id: photo.id,
              userId: photo.user_id,
              storagePath: photo.storage_path,
              position: photo.position,
              url,
            } satisfies ProfilePhoto,
          ]
        : [];
    }),
    interests: interests.map(
      interest =>
        ({
          id: interest.id,
          slug: interest.slug,
          label: interest.label,
          sortOrder: interest.sort_order,
        } satisfies Interest),
    ),
  };
}

export async function listProfileEvents(
  userId: string,
  kind: 'upcoming' | 'attended',
  offset = 0,
): Promise<Event[]> {
  const { data, error } = await supabase.rpc('list_profile_events', {
    profile_user_id: userId,
    list_kind: kind,
    page_size: paginationLimits.profileEvents,
    page_offset: offset,
  });
  if (error) throw error;
  return data.map(item => ({
    id: item.id,
    externalId: null,
    title: item.title,
    summary: null,
    description: null,
    startAt: item.start_at,
    endAt: null,
    venue: item.venue,
    city: item.city,
    district: null,
    address: null,
    imageUrl: item.image_url,
    categories: item.categories,
    sourceUrl: '',
    attendeeCount: 0,
    joined: true,
    saved: false,
  }));
}

export async function reportProfilePhoto(
  userId: string,
  eventId?: string,
  clientRequestId = createClientId(),
): Promise<void> {
  const { error } = await supabase.rpc('submit_report', {
    target_user_id: userId,
    reason: 'other',
    details: 'Profil fotoğrafı üzerinden kullanıcı bildirildi.',
    target_event_id: eventId ?? null,
    client_context: { source: 'profile_photo' },
    block_after: false,
    client_request_id: clientRequestId,
  });
  if (error) throw error;
}

export type ReplacementPhoto =
  | { kind: 'existing'; storagePath: string }
  | {
      kind: 'new';
      base64: string;
      mimeType: string;
      extension: ProfilePhotoExtension;
    };

const photoCleanupKeyPrefix = 'profile-photo-cleanup-v1';
const inMemoryPhotoCleanup = new Map<string, Set<string>>();
const photoCleanupLocks = new Map<string, Promise<void>>();

type PersistedPhotoCleanup = {
  version: 1;
  ownerId: string;
  paths: string[];
};

function hasUnsafeStoragePathCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '\\' || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function photoCleanupKey(ownerId: string): string {
  return `${photoCleanupKeyPrefix}.${ownerId}`;
}

function isOwnedProfilePhotoPath(
  ownerId: string,
  path: unknown,
): path is string {
  if (
    typeof path !== 'string' ||
    path.length > 1_024 ||
    hasUnsafeStoragePathCharacter(path)
  ) {
    return false;
  }
  const segments = path.split('/');
  return (
    segments.length >= 2 &&
    segments[0]?.toLowerCase() === ownerId.toLowerCase() &&
    segments
      .slice(1)
      .every(segment => segment && segment !== '.' && segment !== '..')
  );
}

function withPhotoCleanupLock(
  ownerId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = photoCleanupLocks.get(ownerId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  let tracked: Promise<void>;
  tracked = result
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (photoCleanupLocks.get(ownerId) === tracked) {
        photoCleanupLocks.delete(ownerId);
      }
    });
  photoCleanupLocks.set(ownerId, tracked);
  return result;
}

async function readPendingPhotoCleanup(ownerId: string): Promise<Set<string>> {
  const pending = new Set(inMemoryPhotoCleanup.get(ownerId) ?? []);
  try {
    const raw = await secureStorage.getItem(photoCleanupKey(ownerId));
    if (!raw) return pending;
    const parsed = JSON.parse(raw) as Partial<PersistedPhotoCleanup>;
    if (
      parsed.version !== 1 ||
      parsed.ownerId !== ownerId ||
      !Array.isArray(parsed.paths)
    ) {
      await secureStorage.removeItem(photoCleanupKey(ownerId));
      return pending;
    }
    for (const path of parsed.paths) {
      if (isOwnedProfilePhotoPath(ownerId, path)) pending.add(path);
    }
  } catch (error) {
    captureAppError(error, { operation: 'profile.photo_cleanup_read' });
  }
  return pending;
}

async function persistPendingPhotoCleanup(
  ownerId: string,
  paths: Set<string>,
): Promise<void> {
  inMemoryPhotoCleanup.set(ownerId, new Set(paths));
  try {
    await secureStorage.setItem(
      photoCleanupKey(ownerId),
      JSON.stringify({
        version: 1,
        ownerId,
        paths: [...paths],
      } satisfies PersistedPhotoCleanup),
    );
  } catch (error) {
    captureAppError(error, { operation: 'profile.photo_cleanup_persist' });
  }
}

async function removeProfilePhotoObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await supabase.storage
      .from('profile-photos')
      .remove(paths);
    if (!error) return;
    lastError = error;
  }
  throw lastError ?? new Error('Profil fotoğrafı temizlenemedi.');
}

async function retryPendingProfilePhotoCleanup(
  ownerId: string,
  additionalPaths: string[] = [],
): Promise<void> {
  await withPhotoCleanupLock(ownerId, async () => {
    const pending = await readPendingPhotoCleanup(ownerId);
    for (const path of additionalPaths) {
      if (isOwnedProfilePhotoPath(ownerId, path)) pending.add(path);
    }
    if (pending.size === 0) return;

    // Persist before deletion so a process stop between the Storage call and
    // local acknowledgement can only cause a harmless idempotent retry.
    await persistPendingPhotoCleanup(ownerId, pending);
    try {
      await removeProfilePhotoObjects([...pending]);
    } catch (error) {
      captureAppError(error, { operation: 'profile.photo_cleanup_retry' });
      return;
    }

    inMemoryPhotoCleanup.delete(ownerId);
    try {
      await secureStorage.removeItem(photoCleanupKey(ownerId));
    } catch (error) {
      // The Storage objects are already gone. A stale durable record is safe:
      // the next profile load repeats the idempotent deletion.
      captureAppError(error, { operation: 'profile.photo_cleanup_ack' });
    }
  });
}

/**
 * Drops only process-memory tombstones during logout/account switch. The
 * encrypted durable record intentionally remains until Storage confirms the
 * objects are gone, otherwise logout could turn a transient failure into a
 * permanent orphan.
 */
export function releaseProfilePhotoCleanupMemory(ownerId: string | null): void {
  const ownerIds = ownerId
    ? [ownerId]
    : [
        ...new Set([
          ...inMemoryPhotoCleanup.keys(),
          ...photoCleanupLocks.keys(),
        ]),
      ];
  for (const targetOwnerId of ownerIds) {
    inMemoryPhotoCleanup.delete(targetOwnerId);
    const active = photoCleanupLocks.get(targetOwnerId);
    if (active) {
      void active.then(() => inMemoryPhotoCleanup.delete(targetOwnerId));
    }
  }
}

/** The server has confirmed full account deletion, so no object tombstone remains useful. */
export async function purgeDeletedOwnerPhotoCleanup(
  ownerId: string,
): Promise<void> {
  await photoCleanupLocks.get(ownerId);
  inMemoryPhotoCleanup.delete(ownerId);
  await secureStorage.removeItem(photoCleanupKey(ownerId));
}

export async function replaceProfilePhotos(
  photos: ReplacementPhoto[],
): Promise<void> {
  if (photos.length < 3 || photos.length > 6) {
    throw new Error('En az 3, en fazla 6 fotoğraf gerekir.');
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('Oturum gerekli.');
  await retryPendingProfilePhotoCleanup(auth.user.id);
  const paths: string[] = [];
  let replacementCommitted = false;
  try {
    for (const photo of photos) {
      if (photo.kind === 'existing') {
        if (
          !photo.storagePath.startsWith(`${auth.user.id}/`) ||
          photo.storagePath.split('/').length !== 2
        ) {
          throw new Error('Profil fotoğrafı yolu bu kullanıcıya ait değil.');
        }
        paths.push(photo.storagePath);
        continue;
      }
      const fileData = decode(photo.base64);
      assertValidProfilePhoto(fileData, photo.mimeType, photo.extension);
      const path = `${auth.user.id}/${createClientId()}.${photo.extension}`;
      const { error } = await supabase.storage
        .from('profile-photos')
        .upload(path, fileData, {
          contentType: photo.mimeType,
          cacheControl: '0',
          upsert: false,
        });
      if (error) throw error;
      paths.push(path);
    }
    const { data: previousPaths, error: replaceError } = await supabase.rpc(
      'replace_profile_photos',
      { storage_paths: paths },
    );
    if (replaceError) throw replaceError;
    replacementCommitted = true;
    const removedPaths = previousPaths.filter(path => !paths.includes(path));
    await retryPendingProfilePhotoCleanup(auth.user.id, removedPaths);
  } catch (operationError) {
    const newPaths = paths.filter(
      path =>
        !photos.some(
          photo => photo.kind === 'existing' && photo.storagePath === path,
        ),
    );
    if (!replacementCommitted && newPaths.length) {
      await retryPendingProfilePhotoCleanup(auth.user.id, newPaths);
    }
    throw operationError;
  }
}

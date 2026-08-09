import { paginationLimits } from '@shared/constants/limits';
import { createClientId } from '@shared/lib/ids';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
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
): Promise<void> {
  const { error } = await supabase.rpc('submit_report', {
    target_user_id: userId,
    reason: 'other',
    details: 'Profil fotoğrafı üzerinden kullanıcı bildirildi.',
    target_event_id: eventId ?? null,
    client_context: { source: 'profile_photo' },
    block_after: false,
  });
  if (error) throw error;
}

export type ReplacementPhoto =
  | { kind: 'existing'; storagePath: string }
  | {
      kind: 'new';
      base64: string;
      mimeType: string;
      extension: 'jpg' | 'png' | 'webp' | 'heic' | 'heif';
    };

export async function replaceProfilePhotos(
  photos: ReplacementPhoto[],
): Promise<void> {
  if (photos.length < 3 || photos.length > 6) {
    throw new Error('En az 3, en fazla 6 fotoğraf gerekir.');
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('Oturum gerekli.');
  const paths: string[] = [];
  try {
    for (const photo of photos) {
      if (photo.kind === 'existing') {
        paths.push(photo.storagePath);
        continue;
      }
      const path = `${auth.user.id}/${createClientId()}.${photo.extension}`;
      const { error } = await supabase.storage
        .from('profile-photos')
        .upload(path, decode(photo.base64), {
          contentType: photo.mimeType,
          cacheControl: '31536000',
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
    const removedPaths = previousPaths.filter(path => !paths.includes(path));
    if (removedPaths.length) {
      await supabase.storage.from('profile-photos').remove(removedPaths);
    }
  } catch (error) {
    const newPaths = paths.filter(
      path =>
        !photos.some(
          photo => photo.kind === 'existing' && photo.storagePath === path,
        ),
    );
    if (newPaths.length)
      await supabase.storage.from('profile-photos').remove(newPaths);
    throw error;
  }
}

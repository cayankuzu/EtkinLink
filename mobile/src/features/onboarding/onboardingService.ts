import { createClientId } from '@shared/lib/ids';
import { supabase } from '@shared/lib/supabase';
import type { Interest } from '@shared/types/domain';
import { decode } from 'base64-arraybuffer';

import type { ProfileBasicsValues } from './onboardingSchemas';

export type LocalPhoto = {
  id: string;
  uri: string;
  base64: string;
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp' | 'heic' | 'heif';
};

export async function saveProfileBasics(
  values: ProfileBasicsValues,
): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const { error } = await supabase
    .from('profiles')
    .update({
      username: values.username.trim().toLocaleLowerCase('tr-TR'),
      full_name: values.fullName.trim(),
      birth_date: values.birthDate.toISOString().slice(0, 10),
      gender: values.gender,
    })
    .eq('id', authData.user.id);
  if (error) throw error;
}

export async function saveProfileDetails(
  city: string,
  bio: string,
  interestIds: string[],
): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ city, bio: bio.trim() })
    .eq('id', authData.user.id);
  if (profileError) throw profileError;
  await saveInterests(interestIds);
}

export async function listInterests(): Promise<Interest[]> {
  const { data, error } = await supabase
    .from('interests')
    .select('id,slug,label,sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data.map(item => ({
    id: item.id,
    slug: item.slug,
    label: item.label,
    sortOrder: item.sort_order,
  }));
}

export async function saveInterests(interestIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('replace_profile_interests', {
    interest_ids: interestIds,
  });
  if (error) throw error;
}

export async function uploadProfilePhotos(photos: LocalPhoto[]): Promise<void> {
  if (photos.length < 3 || photos.length > 6) {
    throw new Error('En az 3, en fazla 6 fotoğraf gerekir.');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user.id;
  const uploadedPaths: string[] = [];
  try {
    for (const photo of photos) {
      const path = `${userId}/${createClientId()}.${photo.extension}`;
      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(path, decode(photo.base64), {
          contentType: photo.mimeType,
          upsert: false,
          cacheControl: '31536000',
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
    }
    const { error: replaceError } = await supabase.rpc(
      'replace_profile_photos',
      { storage_paths: uploadedPaths },
    );
    if (replaceError) throw replaceError;
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await supabase.storage.from('profile-photos').remove(uploadedPaths);
    }
    throw error;
  }
}

export async function completeOnboarding(): Promise<void> {
  const { error } = await supabase.rpc('complete_onboarding');
  if (error) throw error;
}

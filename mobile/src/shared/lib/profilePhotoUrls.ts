import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function getSignedProfilePhotoUrls(
  storagePaths: string[],
): Promise<Map<string, string>> {
  const paths = Array.from(new Set(storagePaths.filter(Boolean)));
  if (paths.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;

  return new Map(
    data.flatMap(item =>
      item.path && item.signedUrl ? [[item.path, item.signedUrl] as const] : [],
    ),
  );
}

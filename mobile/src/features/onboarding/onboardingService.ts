import { supabase } from '@shared/lib/supabase';
import type { Interest } from '@shared/types/domain';

export type LocalPhoto = {
  id: string;
  uri: string;
  base64: string;
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp' | 'heic' | 'heif';
};

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

import { listInterests } from '@features/onboarding/onboardingService';
import { premiumFeaturesAvailable } from '@shared/constants/premium';
import { supabase } from '@shared/lib/supabase';
import type { Interest, ProfileGender } from '@shared/types/domain';

export type ProfileMatchFilterSettings = {
  premium: boolean;
  genders: ProfileGender[];
  ageMin: number;
  ageMax: number;
  interestIds: string[];
  interests: Interest[];
};

export async function getProfileMatchFilterSettings(): Promise<ProfileMatchFilterSettings> {
  const [preferenceResult, interests] = await Promise.all([
    supabase.from('discovery_preferences').select('*').single(),
    listInterests(),
  ]);
  if (preferenceResult.error) throw preferenceResult.error;

  return {
    premium: premiumFeaturesAvailable,
    genders: preferenceResult.data.gender_preference,
    ageMin: preferenceResult.data.age_min,
    ageMax: preferenceResult.data.age_max,
    interestIds: preferenceResult.data.required_interest_ids,
    interests,
  };
}

export async function saveProfileMatchFilters(input: {
  genders: ProfileGender[];
  ageMin: number;
  ageMax: number;
  interestIds: string[];
}): Promise<void> {
  if (
    input.genders.length === 0 ||
    !Number.isInteger(input.ageMin) ||
    !Number.isInteger(input.ageMax) ||
    input.ageMin < 18 ||
    input.ageMax > 99 ||
    input.ageMin > input.ageMax
  ) {
    throw new Error(
      'En az bir cinsiyet seç ve 18–99 arasında geçerli bir yaş aralığı gir.',
    );
  }
  const { error } = await supabase.rpc('set_match_filters', {
    genders: input.genders,
    minimum_age: input.ageMin,
    maximum_age: input.ageMax,
    interest_ids: input.interestIds,
  });
  if (error) throw error;
}

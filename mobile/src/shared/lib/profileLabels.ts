import type { ProfileGender } from '@shared/types/domain';

const genderLabels: Record<ProfileGender, string> = {
  woman: 'Kadın',
  man: 'Erkek',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Belirtmek istemiyor',
};

export function getGenderLabel(gender: ProfileGender | null): string {
  return gender ? genderLabels[gender] : 'Cinsiyet gizli';
}

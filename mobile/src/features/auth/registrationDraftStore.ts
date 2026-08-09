import type { ProfileBasicsValues } from '@features/onboarding/onboardingSchemas';
import type { LocalPhoto } from '@features/onboarding/onboardingService';
import { create } from 'zustand';

type RegistrationDetails = {
  city: string;
  bio: string;
  interestIds: string[];
  interestLabels: string[];
};

type RegistrationDraftState = {
  email: string;
  password: string;
  basics: ProfileBasicsValues | null;
  details: RegistrationDetails | null;
  photos: LocalPhoto[];
  submitted: boolean;
  setCredentials: (email: string, password: string) => void;
  setBasics: (basics: ProfileBasicsValues) => void;
  setDetails: (details: RegistrationDetails) => void;
  setPhotos: (photos: LocalPhoto[]) => void;
  markSubmitted: () => void;
  reset: () => void;
};

const initialState = {
  email: '',
  password: '',
  basics: null,
  details: null,
  photos: [] as LocalPhoto[],
  submitted: false,
};

export const useRegistrationDraftStore = create<RegistrationDraftState>(
  set => ({
    ...initialState,
    setCredentials: (email, password) =>
      set({ email: email.trim().toLocaleLowerCase('tr-TR'), password }),
    setBasics: basics => set({ basics }),
    setDetails: details => set({ details }),
    setPhotos: photos => set({ photos }),
    markSubmitted: () => set({ password: '', submitted: true }),
    reset: () => set(initialState),
  }),
);

export function getRegistrationDraft() {
  return useRegistrationDraftStore.getState();
}

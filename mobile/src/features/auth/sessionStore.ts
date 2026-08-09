import { queryClient } from '@shared/lib/queryClient';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { clearPendingVerification } from './pendingVerificationService';
import { finalizePendingRegistration } from './registrationService';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type SessionPhase = 'booting' | 'signedOut' | 'onboarding' | 'signedIn';
type SessionState = {
  phase: SessionPhase;
  session: Session | null;
  profile: ProfileRow | null;
  pendingVerificationEmail: string | null;
  setPendingVerificationEmail: (email: string | null) => void;
  setSession: (session: Session | null) => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) throw error;
  return data.find(profile => profile.id === userId) ?? null;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  phase: 'booting',
  session: null,
  profile: null,
  pendingVerificationEmail: null,

  setPendingVerificationEmail: pendingVerificationEmail =>
    set({ pendingVerificationEmail }),

  async setSession(session) {
    if (!session) {
      set({
        phase: 'signedOut',
        session: null,
        profile: null,
      });
      queryClient.clear();
      return;
    }

    // Registration already collects the complete profile before the
    // verification e-mail is sent. A valid auth session must therefore enter
    // the app immediately; profile synchronization must not send the user
    // through the legacy onboarding flow again.
    set({
      phase: 'signedIn',
      session,
      profile: null,
      pendingVerificationEmail: null,
    });

    try {
      await finalizePendingRegistration();
    } catch (error) {
      console.warn('Kayıt taslağı profile aktarılamadı.', error);
    }
    try {
      await clearPendingVerification();
    } catch (error) {
      // Secure storage cleanup is best-effort. A Keychain cleanup race must
      // never prevent an already authenticated session from entering the app.
      console.warn('Bekleyen doğrulama bilgisi temizlenemedi.', error);
    }

    let profile: ProfileRow | null = null;
    try {
      profile = await fetchProfile(session.user.id);
    } catch (error) {
      // Authentication has already succeeded. Profile synchronization is
      // best-effort and must never change the authenticated route.
      console.warn('Oturum profili yüklenemedi.', error);
    }
    set({
      session,
      profile,
      pendingVerificationEmail: null,
      phase: 'signedIn',
    });
  },

  async refreshProfile() {
    const session = get().session;
    if (!session) return;
    const profile = await fetchProfile(session.user.id);
    set({
      profile,
      phase: 'signedIn',
    });
  },

  async signOut() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    set({
      phase: 'signedOut',
      session: null,
      profile: null,
    });
    queryClient.clear();
  },
}));

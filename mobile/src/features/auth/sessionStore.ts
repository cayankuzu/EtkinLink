import { unregisterCurrentPushToken } from '@shared/lib/pushNotifications';
import { queryClient } from '@shared/lib/queryClient';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import type { Database } from '@shared/types/database';
import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { clearPendingVerification } from './pendingVerificationService';
import { finalizePendingRegistration } from './registrationService';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type SessionPhase = 'booting' | 'signedOut' | 'recovery' | 'signedIn';
type SessionState = {
  phase: SessionPhase;
  session: Session | null;
  profile: ProfileRow | null;
  pendingVerificationEmail: string | null;
  setPendingVerificationEmail: (email: string | null) => void;
  beginPasswordRecovery: (session: Session) => void;
  completePasswordRecovery: () => void;
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

  beginPasswordRecovery: session =>
    set({
      phase: 'recovery',
      session,
      profile: null,
      pendingVerificationEmail: null,
    }),

  completePasswordRecovery: () => {
    const session = get().session;
    set({ phase: session ? 'signedIn' : 'signedOut' });
  },

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
      captureAppError(error, { flow: 'registration.finalize' });
    }
    try {
      await clearPendingVerification();
    } catch (error) {
      // Secure storage cleanup is best-effort. A Keychain cleanup race must
      // never prevent an already authenticated session from entering the app.
      captureAppError(error, { flow: 'verification.cleanup' });
    }

    let profile: ProfileRow | null = null;
    try {
      profile = await fetchProfile(session.user.id);
    } catch (error) {
      // Authentication has already succeeded. Profile synchronization is
      // best-effort and must never change the authenticated route.
      captureAppError(error, { flow: 'session.profile_sync' });
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
    try {
      await unregisterCurrentPushToken();
    } catch (pushError) {
      // Push cleanup is best-effort; a temporary network failure must not
      // prevent the user from closing the local session.
      console.warn('Push bildirimi cihaz kaydı kapatılamadı.', pushError);
    }
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

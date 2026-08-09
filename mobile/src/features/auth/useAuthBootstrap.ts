import { toAppError } from '@shared/lib/errors';
import { startSupabaseAuthLifecycle, supabase } from '@shared/lib/supabase';
import { useEffect } from 'react';
import { Linking } from 'react-native';

import { exchangeAuthCode } from './authService';
import {
  checkPendingVerification,
  getPendingVerificationEmail,
} from './pendingVerificationService';
import { useSessionStore } from './sessionStore';

export function useAuthBootstrap(): void {
  const setSession = useSessionStore(state => state.setSession);
  const setPendingVerificationEmail = useSessionStore(
    state => state.setPendingVerificationEmail,
  );

  useEffect(() => {
    let active = true;
    const stopLifecycle = startSupabaseAuthLifecycle();

    function applySession(session: Parameters<typeof setSession>[0]): void {
      if (session) void supabase.realtime.setAuth(session.access_token);
      void setSession(session).catch(error => {
        console.warn('Oturum durumu uygulanamadı.', toAppError(error).code);
      });
    }

    async function handleUrl(url: string | null): Promise<void> {
      if (!url?.startsWith('etkinlink://auth/')) return;
      try {
        const parsed = new URL(url);
        if (parsed.searchParams.get('verified') === '1') {
          const email = await getPendingVerificationEmail();
          if (email) {
            const result = await checkPendingVerification(email);
            if (result === 'verified' && active) {
              setPendingVerificationEmail(null);
            }
          }
          return;
        }
        if (parsed.searchParams.get('updated') === '1') return;
        await exchangeAuthCode(url);
      } catch (error) {
        console.warn(
          'Kimlik doğrulama bağlantısı işlenemedi.',
          toAppError(error).code,
        );
      }
    }

    void Linking.getInitialURL().then(handleUrl);
    const linkSubscription = Linking.addEventListener('url', event => {
      void handleUrl(event.url);
    });

    void getPendingVerificationEmail().then(email => {
      if (active) setPendingVerificationEmail(email);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      applySession(data.session);
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        applySession(session);
      },
    );

    return () => {
      active = false;
      stopLifecycle();
      linkSubscription.remove();
      authSubscription.subscription.unsubscribe();
    };
  }, [setPendingVerificationEmail, setSession]);
}

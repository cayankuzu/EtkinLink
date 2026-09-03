import { startSupabaseAuthLifecycle, supabase } from '@shared/lib/supabase';
import { warnRedacted } from '@shared/lib/telemetry';
import { useEffect } from 'react';
import { Linking } from 'react-native';

import { exchangeAuthCode } from './authService';
import { getPendingVerificationEmail } from './pendingVerificationService';
import { useSessionStore } from './sessionStore';

export function useAuthBootstrap(): void {
  const setSession = useSessionStore(state => state.setSession);
  const beginPasswordRecovery = useSessionStore(
    state => state.beginPasswordRecovery,
  );
  const setPendingVerificationEmail = useSessionStore(
    state => state.setPendingVerificationEmail,
  );

  useEffect(() => {
    let active = true;
    const stopLifecycle = startSupabaseAuthLifecycle();

    function applySession(session: Parameters<typeof setSession>[0]): void {
      if (session) void supabase.realtime.setAuth(session.access_token);
      if (session && useSessionStore.getState().phase === 'recovery') return;
      void setSession(session).catch(error => {
        warnRedacted('Oturum durumu uygulanamadı.', error);
      });
    }

    async function handleUrl(url: string | null): Promise<void> {
      if (!url) return;
      try {
        const result = await exchangeAuthCode(url);
        if (result === 'ignored') return;
        if (result === 'session' && active) {
          setPendingVerificationEmail(null);
        }
      } catch (error) {
        warnRedacted('Kimlik doğrulama bağlantısı işlenemedi.', error);
      }
    }

    const linkSubscription = Linking.addEventListener('url', event => {
      void handleUrl(event.url);
    });

    void getPendingVerificationEmail().then(email => {
      if (active) setPendingVerificationEmail(email);
    });

    const { data: authSubscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        if (event === 'PASSWORD_RECOVERY' && session) {
          void supabase.realtime.setAuth(session.access_token);
          beginPasswordRecovery(session);
          return;
        }
        applySession(session);
      },
    );

    void (async () => {
      await handleUrl(await Linking.getInitialURL());
      const { data } = await supabase.auth.getSession();
      if (!active || useSessionStore.getState().phase === 'recovery') return;
      applySession(data.session);
    })();

    return () => {
      active = false;
      stopLifecycle();
      linkSubscription.remove();
      authSubscription.subscription.unsubscribe();
    };
  }, [beginPasswordRecovery, setPendingVerificationEmail, setSession]);
}

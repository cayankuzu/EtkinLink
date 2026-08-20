import 'react-native-url-polyfill/auto';

import { env } from '@shared/config/env';
import type { Database } from '@shared/types/database';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { fetchWithTimeout } from './network';
import { secureStorage } from './secureStorage';

export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    realtime: {
      params: { eventsPerSecond: 8 },
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
);

let authLifecycleStarted = false;

export function startSupabaseAuthLifecycle(): () => void {
  if (authLifecycleStarted) return () => undefined;
  authLifecycleStarted = true;
  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();

  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });

  return () => {
    subscription.remove();
    supabase.auth.stopAutoRefresh();
    authLifecycleStarted = false;
  };
}

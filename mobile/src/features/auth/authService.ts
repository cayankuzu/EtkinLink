import { env } from '@shared/config/env';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database';
import { createClient } from '@supabase/supabase-js';

import type { SignInValues, SignUpValues } from './authSchemas';

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

export async function isEmailAvailable(value: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_email_available', {
    candidate_email: normalizeEmail(value),
  });
  if (error) throw error;
  return data;
}

const authCallbackUrl =
  'https://cayankuzu.github.io/EtkinLink_web/auth/confirm.html';
const resetPasswordUrl =
  'https://cayankuzu.github.io/EtkinLink_web/auth/reset-password.html';

// Recovery links are completed in the user's browser. An isolated implicit-flow
// client keeps the recovery token usable on that browser without changing the
// app's persistent PKCE session.
const passwordRecoveryClient = createClient<Database>(
  env.supabaseUrl,
  env.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      flowType: 'implicit',
    },
  },
);

export type RegistrationMetadata = {
  fullName: string;
  username: string;
  birthDate: string;
  gender: 'woman' | 'man' | 'non_binary' | 'prefer_not_to_say';
  city: string;
  bio: string;
  interestIds: string[];
};

export async function signIn(values: SignInValues): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(values.email),
    password: values.password,
  });
  if (error) throw error;
}

export async function signUp(
  values: SignUpValues,
  metadata: RegistrationMetadata,
): Promise<void> {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(values.email),
    password: values.password,
    options: {
      emailRedirectTo: authCallbackUrl,
      data: {
        full_name: metadata.fullName.trim(),
        username: metadata.username.trim().toLocaleLowerCase('tr-TR'),
        birth_date: metadata.birthDate,
        gender: metadata.gender,
        city: metadata.city,
        bio: metadata.bio.trim(),
        interest_ids: metadata.interestIds,
      },
    },
  });
  if (error) throw error;
  if (data.user && data.user.identities?.length === 0) {
    throw new Error('Bu e-posta adresiyle daha önce hesap oluşturulmuş.');
  }
}

export async function resendSignUpEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLocaleLowerCase('tr-TR'),
    options: { emailRedirectTo: authCallbackUrl },
  });
  if (error) throw error;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await passwordRecoveryClient.auth.resetPasswordForEmail(
    email.trim().toLocaleLowerCase('tr-TR'),
    { redirectTo: resetPasswordUrl },
  );
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function exchangeAuthCode(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  const accessToken = parsed.searchParams.get('access_token');
  const refreshToken = parsed.searchParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return true;
  }
  return false;
}

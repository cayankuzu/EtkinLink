import { env } from '@shared/config/env';
import { AppError } from '@shared/lib/errors';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';

import type { SignInValues, SignUpValues } from './authSchemas';

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

const authCallbackUrl = 'etkinlink://auth/callback';
const resetPasswordUrl = 'etkinlink://auth/reset-password';
const allowedAuthCallbackPaths = new Set(['/callback', '/reset-password']);
const forbiddenSessionParameters = [
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
] as const;

export type RegistrationMetadata = {
  fullName: string;
  username: string;
  birthDate: string;
  gender: 'woman' | 'man' | 'non_binary' | 'prefer_not_to_say';
  city: string;
  bio: string;
  interestIds: string[];
};

function throwAuthError(error: Error, operation: string): never {
  captureAppError(error, { operation });
  throw error;
}

export function assertAuthBackendConfigured(
  isConfigured = env.isSupabaseConfigured,
): void {
  if (isConfigured) return;
  throw new AppError(
    'configuration',
    'Uygulamanın sunucu bağlantısı yapılandırılamadı. Lütfen güncel sürümü yükleyip tekrar dene.',
  );
}

export async function signIn(values: SignInValues): Promise<void> {
  assertAuthBackendConfigured();
  const { error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(values.email),
    password: values.password,
  });
  if (error) throwAuthError(error, 'auth.sign_in');
}

export async function signUp(
  values: SignUpValues,
  metadata: RegistrationMetadata,
): Promise<void> {
  assertAuthBackendConfigured();
  const { error } = await supabase.auth.signUp({
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
  if (error) throwAuthError(error, 'auth.sign_up');
}

export async function resendSignUpEmail(email: string): Promise<void> {
  assertAuthBackendConfigured();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLocaleLowerCase('tr-TR'),
    options: { emailRedirectTo: authCallbackUrl },
  });
  if (error) throwAuthError(error, 'auth.resend_signup');
}

export async function sendPasswordReset(email: string): Promise<void> {
  assertAuthBackendConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(
    email.trim().toLocaleLowerCase('tr-TR'),
    { redirectTo: resetPasswordUrl },
  );
  if (error) throwAuthError(error, 'auth.password_reset');
}

export async function updatePassword(password: string): Promise<void> {
  assertAuthBackendConfigured();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throwAuthError(error, 'auth.password_update');
}

export type AuthCodeExchangeResult = 'session' | 'recovery' | 'ignored';

function hasRawSessionParameters(parsed: URL): boolean {
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return forbiddenSessionParameters.some(
    parameter => parsed.searchParams.has(parameter) || fragment.has(parameter),
  );
}

export function isTrustedAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'etkinlink:' &&
      parsed.hostname === 'auth' &&
      allowedAuthCallbackPaths.has(parsed.pathname) &&
      !hasRawSessionParameters(parsed)
    );
  } catch {
    return false;
  }
}

export async function exchangeAuthCode(
  url: string,
): Promise<AuthCodeExchangeResult> {
  const parsed = new URL(url);
  if (!isTrustedAuthCallback(url)) return 'ignored';
  if (hasRawSessionParameters(parsed)) {
    throw new Error(
      'Oturum anahtarı içeren bağlantılar güvenlik nedeniyle reddedildi.',
    );
  }
  const code = parsed.searchParams.get('code');
  if (!code || code.length > 4096) return 'ignored';

  assertAuthBackendConfigured();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throwAuthError(error, 'auth.code_exchange');
  return parsed.pathname === '/reset-password' ? 'recovery' : 'session';
}

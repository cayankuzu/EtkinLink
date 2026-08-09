import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';

const pendingVerificationKey = 'registration.pending-verification';
const maximumCredentialAgeMs = 24 * 60 * 60_000;
let clearPendingVerificationPromise: Promise<void> | null = null;

type PendingVerification = {
  email: string;
  password: string;
  createdAt: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('tr-TR');
}

async function readPendingVerification(): Promise<PendingVerification | null> {
  const raw = await secureStorage.getItem(pendingVerificationKey);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingVerification;
    const createdAt = new Date(pending.createdAt).getTime();
    if (
      !pending.email ||
      !pending.password ||
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > maximumCredentialAgeMs
    ) {
      await clearPendingVerification();
      return null;
    }
    return pending;
  } catch {
    await clearPendingVerification();
    return null;
  }
}

export async function persistPendingVerification(
  email: string,
  password: string,
): Promise<void> {
  const pending: PendingVerification = {
    email: normalizeEmail(email),
    password,
    createdAt: new Date().toISOString(),
  };
  await secureStorage.setItem(pendingVerificationKey, JSON.stringify(pending));
}

export async function getPendingVerificationEmail(): Promise<string | null> {
  return (await readPendingVerification())?.email ?? null;
}

export async function clearPendingVerification(): Promise<void> {
  clearPendingVerificationPromise ??= secureStorage
    .removeItem(pendingVerificationKey)
    .finally(() => {
      clearPendingVerificationPromise = null;
    });
  await clearPendingVerificationPromise;
}

export async function checkPendingVerification(
  email: string,
): Promise<'verified' | 'pending' | 'missing' | 'credentials_invalid'> {
  const pending = await readPendingVerification();
  if (!pending || pending.email !== normalizeEmail(email)) return 'missing';

  const { error } = await supabase.auth.signInWithPassword({
    email: pending.email,
    password: pending.password,
  });
  if (!error) {
    await clearPendingVerification();
    return 'verified';
  }
  if (error.code === 'email_not_confirmed') return 'pending';
  // A repeated signup can belong to an older, still-unconfirmed account.
  // Supabase resends its confirmation without replacing that account's
  // password, so expose a recoverable state instead of the provider's raw
  // "Invalid login credentials" message.
  if (error.code === 'invalid_credentials') return 'credentials_invalid';
  throw error;
}

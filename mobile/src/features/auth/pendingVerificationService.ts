import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';

const pendingVerificationKey = 'registration.pending-verification';
const maximumPendingAgeMs = 24 * 60 * 60_000;
let clearPendingVerificationPromise: Promise<void> | null = null;

type PendingVerification = {
  email: string;
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
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > maximumPendingAgeMs
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

export async function persistPendingVerification(email: string): Promise<void> {
  const pending: PendingVerification = {
    email: normalizeEmail(email),
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
): Promise<'verified' | 'pending' | 'missing'> {
  const pending = await readPendingVerification();
  if (!pending || pending.email !== normalizeEmail(email)) return 'missing';

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (normalizeEmail(data.session?.user.email ?? '') === pending.email) {
    await clearPendingVerification();
    return 'verified';
  }
  return 'pending';
}

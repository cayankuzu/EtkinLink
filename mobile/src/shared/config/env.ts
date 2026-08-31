import Config from 'react-native-config';

const fallbackUrl = 'https://invalid.supabase.co';
const fallbackKey = 'missing-publishable-key';

export function isSecureBackendUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      parsed.hostname !== 'invalid.supabase.co'
    );
  } catch {
    return false;
  }
}

export function isSupabasePublishableKey(value: string | undefined): boolean {
  if (!value) return false;
  return (
    /^sb_publishable_[A-Za-z0-9_-]{8,}$/u.test(value) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)
  );
}

export function normalizeHttpsOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function boundedSampleRate(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.05;
}

const supabaseUrl = Config.SUPABASE_URL?.trim();
const supabasePublishableKey = Config.SUPABASE_PUBLISHABLE_KEY?.trim();
const edgeApiBaseUrl = normalizeHttpsOrigin(Config.EDGE_API_BASE_URL);

export const env = {
  supabaseUrl: supabaseUrl || fallbackUrl,
  supabasePublishableKey: supabasePublishableKey || fallbackKey,
  isSupabaseConfigured:
    isSecureBackendUrl(supabaseUrl) &&
    isSupabasePublishableKey(supabasePublishableKey),
  edgeApiBaseUrl,
  sentryDsn: Config.SENTRY_DSN?.trim() || null,
  sentryTracesSampleRate: boundedSampleRate(
    Config.SENTRY_TRACES_SAMPLE_RATE?.trim(),
  ),
} as const;

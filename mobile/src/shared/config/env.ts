import Config from 'react-native-config';

const fallbackUrl = 'https://invalid.supabase.co';
const fallbackKey = 'missing-publishable-key';

export const env = {
  supabaseUrl: Config.SUPABASE_URL?.trim() || fallbackUrl,
  supabasePublishableKey:
    Config.SUPABASE_PUBLISHABLE_KEY?.trim() || fallbackKey,
  sentryDsn: Config.SENTRY_DSN?.trim() || null,
} as const;

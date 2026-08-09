declare module 'react-native-config' {
  export interface NativeConfig {
    readonly SUPABASE_URL?: string;
    readonly SUPABASE_PUBLISHABLE_KEY?: string;
    readonly SENTRY_DSN?: string;
  }

  const Config: NativeConfig;
  export default Config;
}

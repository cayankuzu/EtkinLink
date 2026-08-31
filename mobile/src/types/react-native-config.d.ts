declare module 'react-native-config' {
  export interface NativeConfig {
    readonly SUPABASE_URL?: string;
    readonly SUPABASE_PUBLISHABLE_KEY?: string;
    readonly EDGE_API_BASE_URL?: string;
    readonly SENTRY_DSN?: string;
    readonly SENTRY_TRACES_SAMPLE_RATE?: string;
  }

  const Config: NativeConfig;
  export default Config;
}

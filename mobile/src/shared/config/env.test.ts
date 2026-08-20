import { isSecureBackendUrl, isSupabasePublishableKey } from './env';

describe('release backend yapılandırması', () => {
  it('yalnızca güvenli ve gerçek backend URL değerlerini kabul eder', () => {
    expect(isSecureBackendUrl('https://project.supabase.co')).toBe(true);
    expect(isSecureBackendUrl('https://api.etkinlink.app')).toBe(true);
    expect(isSecureBackendUrl('https://invalid.supabase.co')).toBe(false);
    expect(isSecureBackendUrl('http://project.supabase.co')).toBe(false);
    expect(isSecureBackendUrl(undefined)).toBe(false);
  });

  it('publishable ve legacy anon anahtar biçimlerini doğrular', () => {
    expect(isSupabasePublishableKey('sb_publishable_abcdefgh')).toBe(true);
    expect(isSupabasePublishableKey('eyJheader.payload.signature')).toBe(true);
    expect(isSupabasePublishableKey('missing-publishable-key')).toBe(false);
    expect(isSupabasePublishableKey(undefined)).toBe(false);
  });
});

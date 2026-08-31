import {
  isSecureBackendUrl,
  isSupabasePublishableKey,
  normalizeHttpsOrigin,
} from './env';

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

  it('edge gateway için yalnız çıplak HTTPS origin kabul eder', () => {
    expect(normalizeHttpsOrigin('https://api.etkinlink.example')).toBe(
      'https://api.etkinlink.example',
    );
    expect(normalizeHttpsOrigin('https://api.example/')).toBe(
      'https://api.example',
    );
    expect(normalizeHttpsOrigin('http://api.example')).toBeNull();
    expect(normalizeHttpsOrigin('https://api.example/v1')).toBeNull();
    expect(normalizeHttpsOrigin('https://user:pass@api.example')).toBeNull();
    expect(normalizeHttpsOrigin(undefined)).toBeNull();
  });
});

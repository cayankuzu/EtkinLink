import { supabase } from '@shared/lib/supabase';

import {
  assertAuthBackendConfigured,
  exchangeAuthCode,
  isTrustedAuthCallback,
  signUp,
} from './authService';

jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      exchangeCodeForSession: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resend: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

const exchangeCodeForSession = jest.mocked(
  supabase.auth.exchangeCodeForSession,
);
const signUpWithPassword = jest.mocked(supabase.auth.signUp);

describe('güvenli auth callback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('eksik backend yapılandırmasını internet hatası gibi göstermez', () => {
    expect(() => assertAuthBackendConfigured(false)).toThrow(
      expect.objectContaining({
        code: 'configuration',
        message: expect.stringContaining('sunucu bağlantısı'),
      }),
    );
  });

  it('yalnızca beklenen uygulama auth rotalarını kabul eder', () => {
    expect(
      isTrustedAuthCallback('etkinlink://auth/callback?code=secure-code'),
    ).toBe(true);
    expect(
      isTrustedAuthCallback('etkinlink://auth/reset-password?code=secure-code'),
    ).toBe(true);
    expect(isTrustedAuthCallback('etkinlink://profile?code=secure-code')).toBe(
      false,
    );
    expect(
      isTrustedAuthCallback('https://evil.example/auth/callback?code=x'),
    ).toBe(false);
  });

  it.each([
    'etkinlink://auth/callback?access_token=a&refresh_token=b',
    'etkinlink://auth/callback#access_token=a&refresh_token=b',
  ])('URL içinde ham oturum anahtarını reddeder: %s', async url => {
    await expect(exchangeAuthCode(url)).resolves.toBe('ignored');
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('yalnızca PKCE kodunu session ile değiştirir', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      data: { redirectType: null },
      error: null,
    } as never);

    await expect(
      exchangeAuthCode('etkinlink://auth/callback?code=secure-code'),
    ).resolves.toBe('session');
    expect(exchangeCodeForSession).toHaveBeenCalledWith('secure-code');
  });

  it('recovery callback türünü korur', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      data: { redirectType: 'recovery' },
      error: null,
    } as never);

    await expect(
      exchangeAuthCode('etkinlink://auth/reset-password?code=recovery-code'),
    ).resolves.toBe('recovery');
  });

  it('mevcut hesap için Auth tarafından gizlenen yanıtı kullanıcıya açıklamaz', async () => {
    signUpWithPassword.mockResolvedValueOnce({
      data: {
        user: { identities: [] },
        session: null,
      },
      error: null,
    } as never);

    await expect(
      signUp(
        { email: 'mevcut@ornek.com', password: 'Guvenli1234' },
        {
          fullName: 'Örnek Kullanıcı',
          username: 'ornek_kullanici',
          birthDate: '1995-01-01',
          gender: 'prefer_not_to_say',
          city: 'İstanbul',
          bio: '',
          interestIds: [],
        },
      ),
    ).resolves.toBeUndefined();
  });
});

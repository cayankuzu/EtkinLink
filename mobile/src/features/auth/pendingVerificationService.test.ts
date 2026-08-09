import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';

import {
  checkPendingVerification,
  clearPendingVerification,
  getPendingVerificationEmail,
  persistPendingVerification,
} from './pendingVerificationService';

jest.mock('@shared/lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('@shared/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn() } },
}));

const storage = jest.mocked(secureStorage);
const signInWithPassword = jest.mocked(supabase.auth.signInWithPassword);

describe('bekleyen e-posta doğrulaması', () => {
  let storedValue: string | null;

  beforeEach(() => {
    storedValue = null;
    jest.clearAllMocks();
    storage.getItem.mockImplementation(async () => storedValue);
    storage.setItem.mockImplementation(async (_key, value) => {
      storedValue = value;
    });
    storage.removeItem.mockImplementation(async () => {
      storedValue = null;
    });
  });

  it('bekleyen hesabı cihazın güvenli deposunda saklar', async () => {
    await persistPendingVerification(' Test@Example.com ', 'Guvenli1234');

    await expect(getPendingVerificationEmail()).resolves.toBe(
      'test@example.com',
    );
    expect(storedValue).not.toContain(' Test@Example.com ');
  });

  it('e-posta henüz onaylanmadığında oturum açmaz', async () => {
    await persistPendingVerification('test@example.com', 'Guvenli1234');
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'email_not_confirmed' },
    } as never);

    await expect(checkPendingVerification('test@example.com')).resolves.toBe(
      'pending',
    );
    expect(storedValue).not.toBeNull();
  });

  it('onaylanan hesapta oturum açar ve geçici parolayı siler', async () => {
    await persistPendingVerification('test@example.com', 'Guvenli1234');
    signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'user-id' }, session: { access_token: 'token' } },
      error: null,
    } as never);

    await expect(checkPendingVerification('test@example.com')).resolves.toBe(
      'verified',
    );
    expect(storage.removeItem).toHaveBeenCalled();
    expect(storedValue).toBeNull();
  });

  it('eski kayıt şifresi uyuşmadığında kurtarılabilir durum döndürür', async () => {
    await persistPendingVerification('test@example.com', 'YeniGuvenli1234');
    signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
      },
    } as never);

    await expect(checkPendingVerification('test@example.com')).resolves.toBe(
      'credentials_invalid',
    );
    expect(storedValue).not.toBeNull();
  });

  it('eşzamanlı temizleme isteklerini tek bir güvenli depo işleminde birleştirir', async () => {
    let finishRemoval: (() => void) | undefined;
    storage.removeItem.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishRemoval = resolve;
        }),
    );

    const firstRemoval = clearPendingVerification();
    const secondRemoval = clearPendingVerification();

    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    finishRemoval?.();
    await Promise.all([firstRemoval, secondRemoval]);
  });
});

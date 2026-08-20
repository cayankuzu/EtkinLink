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
  supabase: { auth: { getSession: jest.fn() } },
}));

const storage = jest.mocked(secureStorage);
const getSession = jest.mocked(supabase.auth.getSession);

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
    await persistPendingVerification(' Test@Example.com ');

    await expect(getPendingVerificationEmail()).resolves.toBe(
      'test@example.com',
    );
    expect(storedValue).not.toContain(' Test@Example.com ');
    expect(storedValue).not.toContain('Guvenli1234');
  });

  it('e-posta callback ile oturum oluşmadan önce bekleyen durumda kalır', async () => {
    await persistPendingVerification('test@example.com');
    getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    } as never);

    await expect(checkPendingVerification('test@example.com')).resolves.toBe(
      'pending',
    );
    expect(storedValue).not.toBeNull();
  });

  it('PKCE callback sonrası oturumu görür ve bekleyen e-postayı siler', async () => {
    await persistPendingVerification('test@example.com');
    getSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'token',
          user: { id: 'user-id', email: 'test@example.com' },
        },
      },
      error: null,
    } as never);

    await expect(checkPendingVerification('test@example.com')).resolves.toBe(
      'verified',
    );
    expect(storage.removeItem).toHaveBeenCalled();
    expect(storedValue).toBeNull();
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

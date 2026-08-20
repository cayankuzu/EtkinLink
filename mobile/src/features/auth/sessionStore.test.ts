import { queryClient } from '@shared/lib/queryClient';
import { supabase } from '@shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';

import { clearPendingVerification } from './pendingVerificationService';
import { finalizePendingRegistration } from './registrationService';
import { useSessionStore } from './sessionStore';

jest.mock('@shared/lib/queryClient', () => ({
  queryClient: { clear: jest.fn() },
}));

jest.mock('@shared/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock('./pendingVerificationService', () => ({
  clearPendingVerification: jest.fn(),
}));

jest.mock('./registrationService', () => ({
  finalizePendingRegistration: jest.fn(),
}));

const rpc = jest.mocked(supabase.rpc);
const clearVerification = jest.mocked(clearPendingVerification);
const finalizeRegistration = jest.mocked(finalizePendingRegistration);

const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-id' },
} as Session;

describe('oturum yönlendirmesi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearVerification.mockResolvedValue();
    finalizeRegistration.mockResolvedValue(false);
    useSessionStore.setState({
      phase: 'booting',
      session: null,
      profile: null,
      pendingVerificationEmail: 'test@example.com',
    });
  });

  it('doğrulanmış oturumu profil tamamlamaya değil ana uygulamaya alır', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null } as never);

    await useSessionStore.getState().setSession(session);

    expect(useSessionStore.getState()).toMatchObject({
      phase: 'signedIn',
      session,
      pendingVerificationEmail: null,
    });
  });

  it('profil sorgusu hata verse bile Keşfet rotasını açık tutar', async () => {
    rpc.mockRejectedValueOnce({ message: '' });

    await useSessionStore.getState().setSession(session);

    expect(useSessionStore.getState().phase).toBe('signedIn');
  });

  it('parola kurtarma oturumunu ana uygulamaya erken sokmaz', () => {
    useSessionStore.getState().beginPasswordRecovery(session);

    expect(useSessionStore.getState()).toMatchObject({
      phase: 'recovery',
      session,
    });

    useSessionStore.getState().completePasswordRecovery();
    expect(useSessionStore.getState().phase).toBe('signedIn');
  });

  it('çıkışta oturum ve sorgu önbelleğini temizler', async () => {
    await useSessionStore.getState().setSession(null);

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });
});

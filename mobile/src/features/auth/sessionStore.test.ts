import { clearEventFeedSnapshot } from '@features/events/eventFeedSnapshot';
import { clearEventFeedCache } from '@features/events/eventService';
import { releaseProfilePhotoCleanupMemory } from '@features/profile/profileService';
import { purgeAllOutbox, purgeOutboxForOwner } from '@shared/lib/chatOutbox';
import { unregisterCurrentPushToken } from '@shared/lib/pushNotifications';
import { queryClient } from '@shared/lib/queryClient';
import { supabase } from '@shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Image as ExpoImage } from 'expo-image';

import { clearPendingVerification } from './pendingVerificationService';
import { finalizePendingRegistration } from './registrationService';
import { useSessionStore } from './sessionStore';

jest.mock('@features/events/eventFeedSnapshot', () => ({
  clearEventFeedSnapshot: jest.fn(),
}));

jest.mock('@features/events/eventService', () => ({
  clearEventFeedCache: jest.fn(),
}));

jest.mock('@features/profile/profileService', () => ({
  releaseProfilePhotoCleanupMemory: jest.fn(),
}));

jest.mock('@shared/lib/chatOutbox', () => ({
  purgeAllOutbox: jest.fn(),
  purgeOutboxForOwner: jest.fn(),
}));

jest.mock('@shared/lib/pushNotifications', () => ({
  unregisterCurrentPushToken: jest.fn(),
}));

jest.mock('@shared/lib/queryClient', () => ({
  queryClient: { clear: jest.fn() },
}));

jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn() },
    removeAllChannels: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('./pendingVerificationService', () => ({
  clearPendingVerification: jest.fn(),
}));

jest.mock('./registrationService', () => ({
  finalizePendingRegistration: jest.fn(),
}));

const rpc = jest.mocked(supabase.rpc);
const authSignOut = jest.mocked(supabase.auth.signOut);
const removeAllChannels = jest.mocked(supabase.removeAllChannels);
const clearVerification = jest.mocked(clearPendingVerification);
const finalizeRegistration = jest.mocked(finalizePendingRegistration);
const clearSnapshot = jest.mocked(clearEventFeedSnapshot);
const clearEventCache = jest.mocked(clearEventFeedCache);
const releasePhotoCleanupMemory = jest.mocked(releaseProfilePhotoCleanupMemory);
const purgeAll = jest.mocked(purgeAllOutbox);
const purgeOwner = jest.mocked(purgeOutboxForOwner);
const unregisterPush = jest.mocked(unregisterCurrentPushToken);
const clearImageMemoryCache = jest.mocked(ExpoImage.clearMemoryCache);

const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: 'user-id' },
} as Session;

describe('session routing and privacy cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authSignOut.mockResolvedValue({ error: null });
    removeAllChannels.mockResolvedValue([]);
    unregisterPush.mockResolvedValue();
    clearImageMemoryCache.mockResolvedValue(true);
    clearSnapshot.mockResolvedValue();
    purgeAll.mockResolvedValue();
    purgeOwner.mockResolvedValue();
    clearVerification.mockResolvedValue();
    finalizeRegistration.mockResolvedValue(false);
    useSessionStore.setState({
      phase: 'booting',
      session: null,
      profile: null,
      pendingVerificationEmail: 'test@example.com',
    });
  });

  it('routes a verified session directly into the signed-in app', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null } as never);

    await useSessionStore.getState().setSession(session);

    expect(useSessionStore.getState()).toMatchObject({
      phase: 'signedIn',
      session,
      pendingVerificationEmail: null,
    });
  });

  it('keeps the signed-in route when profile synchronization fails', async () => {
    rpc.mockRejectedValueOnce({ message: '' });

    await useSessionStore.getState().setSession(session);

    expect(useSessionStore.getState().phase).toBe('signedIn');
  });

  it('does not route a password recovery session into the app early', () => {
    useSessionStore.getState().beginPasswordRecovery(session);

    expect(useSessionStore.getState()).toMatchObject({
      phase: 'recovery',
      session,
    });

    useSessionStore.getState().completePasswordRecovery();
    expect(useSessionStore.getState().phase).toBe('signedIn');
  });

  it('purges all orphaned local data when session loss has no known owner', async () => {
    await useSessionStore.getState().setSession(null);

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
    expect(clearEventCache).toHaveBeenCalledTimes(1);
    expect(clearSnapshot).toHaveBeenCalledTimes(1);
    expect(purgeAll).toHaveBeenCalledTimes(1);
    expect(purgeOwner).not.toHaveBeenCalled();
    expect(removeAllChannels).toHaveBeenCalledTimes(1);
    expect(clearImageMemoryCache).toHaveBeenCalledTimes(1);
    expect(releasePhotoCleanupMemory).toHaveBeenCalledWith(null);
  });

  it('uses owner-scoped outbox cleanup for a known lost session', async () => {
    useSessionStore.setState({ phase: 'signedIn', session });

    await useSessionStore.getState().setSession(null);

    expect(purgeOwner).toHaveBeenCalledWith('user-id');
    expect(purgeAll).not.toHaveBeenCalled();
    expect(removeAllChannels).toHaveBeenCalledTimes(1);
    expect(clearImageMemoryCache).toHaveBeenCalledTimes(1);
    expect(releasePhotoCleanupMemory).toHaveBeenCalledWith('user-id');
  });

  it('continues local sign-out when private image memory cleanup fails', async () => {
    clearImageMemoryCache.mockRejectedValueOnce(
      new Error('native image cache unavailable'),
    );
    useSessionStore.setState({ phase: 'signedIn', session });

    await expect(useSessionStore.getState().signOut()).resolves.toBeUndefined();

    expect(useSessionStore.getState().phase).toBe('signedOut');
    expect(purgeOwner).toHaveBeenCalledWith('user-id');
    expect(removeAllChannels).toHaveBeenCalledTimes(1);
  });

  it('clears local state and channels even when Supabase sign-out reports an error', async () => {
    const signOutError = new Error('local sign-out failed');
    authSignOut.mockResolvedValueOnce({ error: signOutError } as never);
    useSessionStore.setState({ phase: 'signedIn', session });

    await expect(useSessionStore.getState().signOut()).rejects.toBe(
      signOutError,
    );

    expect(unregisterPush).toHaveBeenCalledTimes(1);
    expect(authSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(useSessionStore.getState()).toMatchObject({
      phase: 'signedOut',
      session: null,
      profile: null,
    });
    expect(clearEventCache).toHaveBeenCalledTimes(1);
    expect(clearSnapshot).toHaveBeenCalledTimes(1);
    expect(purgeOwner).toHaveBeenCalledWith('user-id');
    expect(removeAllChannels).toHaveBeenCalledTimes(1);
  });
});

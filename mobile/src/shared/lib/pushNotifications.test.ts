jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => ({ data: null, error: null })),
  },
}));

jest.mock('@shared/lib/telemetry', () => ({
  captureAppError: jest.fn(),
  warnRedacted: jest.fn(),
}));

jest.mock('@shared/lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('@shared/lib/ids', () => ({
  createClientId: jest.fn(() => '10000000-0000-4000-8000-000000000001'),
}));

jest.mock('expo-updates', () => ({ channel: 'development' }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClientId } from '@shared/lib/ids';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError, warnRedacted } from '@shared/lib/telemetry';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import {
  enablePushNotifications,
  ensureNotificationPermission,
  tombstoneCurrentPushRegistration,
  unregisterCurrentPushToken,
  usePushRegistration,
} from './pushNotifications';

const getPermissionsAsync = jest.mocked(Notifications.getPermissionsAsync);
const requestPermissionsAsync = jest.mocked(
  Notifications.requestPermissionsAsync,
);
const setNotificationChannelAsync = jest.mocked(
  Notifications.setNotificationChannelAsync,
);
const getExpoPushTokenAsync = jest.mocked(Notifications.getExpoPushTokenAsync);
const legacyStorageRemoveItem = jest.mocked(AsyncStorage.removeItem);
const storageGetItem = jest.mocked(secureStorage.getItem);
const storageRemoveItem = jest.mocked(secureStorage.removeItem);
const storageSetItem = jest.mocked(secureStorage.setItem);
const mockCreateClientId = jest.mocked(createClientId);
const mockRpc = supabase.rpc as jest.Mock;
const mockCaptureAppError = jest.mocked(captureAppError);
const mockWarnRedacted = jest.mocked(warnRedacted);

function storedRegistration(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    installationId: '10000000-0000-4000-8000-000000000001',
    token: 'ExponentPushToken[stored-token]',
    userId: 'user-1',
    platform: 'android',
    environment: 'development',
    projectId: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
    syncState: 'registered',
    previousTokens: [],
    ...overrides,
  });
}

describe('bildirim izni başlangıç akışı', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('izin henüz seçilmediyse genel bildirimi ister ve bütün kanalları açar', async () => {
    getPermissionsAsync.mockResolvedValueOnce({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);
    requestPermissionsAsync.mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    await expect(ensureNotificationPermission()).resolves.toBe(true);

    expect(requestPermissionsAsync).toHaveBeenCalledWith({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowProvisional: false,
      },
    });
    expect(setNotificationChannelAsync).toHaveBeenCalledTimes(5);
    expect(setNotificationChannelAsync).toHaveBeenCalledWith(
      'system-v2',
      expect.objectContaining({
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
      }),
    );
  });

  it('izin zaten verilmişse kullanıcıya yeniden sormaz', async () => {
    getPermissionsAsync.mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    await expect(ensureNotificationPermission()).resolves.toBe(true);
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('izin reddedilmiş ve tekrar sorulamıyorsa false döner', async () => {
    getPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    await expect(ensureNotificationPermission()).resolves.toBe(false);
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('izin isteği reddedilirse false döner', async () => {
    getPermissionsAsync.mockResolvedValueOnce({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);
    requestPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    await expect(ensureNotificationPermission()).resolves.toBe(false);
  });
});

describe('push token yaşam döngüsü', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
  });

  beforeEach(async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    storageGetItem.mockResolvedValue(null);
    await unregisterCurrentPushToken();
    jest.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);
    getExpoPushTokenAsync.mockResolvedValue({
      data: 'ExpoPushToken[token-one]',
      type: 'expo',
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
    storageGetItem.mockResolvedValue(null);
  });

  afterEach(async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    storageGetItem.mockResolvedValue(null);
    await unregisterCurrentPushToken();
    jest.useRealTimers();
  });

  it('izin yoksa token istemez veya sunucu kaydı yapmaz', async () => {
    getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    await expect(enablePushNotifications('user-1')).resolves.toBe(false);

    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(storageSetItem).not.toHaveBeenCalled();
  });

  it('fiziksel cihaz tokenını güvenli kurulum, ortam, platform ve sürüm bağıyla kaydeder', async () => {
    await expect(enablePushNotifications('user-1')).resolves.toBe(true);

    expect(getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
    });
    expect(mockRpc).toHaveBeenCalledWith('sync_push_installation', {
      expo_token: 'ExpoPushToken[token-one]',
      token_platform: 'android',
      project_id: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
      client_installation_id: '10000000-0000-4000-8000-000000000001',
      app_environment: 'development',
      app_version: '1.0.0',
      previous_expo_tokens: [],
    });
    expect(mockCreateClientId).toHaveBeenCalledTimes(1);
    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-installation-v1',
      '10000000-0000-4000-8000-000000000001',
    );
    expect(storageSetItem).toHaveBeenLastCalledWith(
      '@etkinlink/push-registration-v2',
      JSON.stringify({
        schemaVersion: 2,
        installationId: '10000000-0000-4000-8000-000000000001',
        token: 'ExpoPushToken[token-one]',
        userId: 'user-1',
        platform: 'android',
        environment: 'development',
        projectId: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
        syncState: 'registered',
        previousTokens: [],
      }),
    );
    expect(legacyStorageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v1',
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('EAS preview profilini production token havuzundan ayırır', async () => {
    const channel = jest.replaceProperty(Updates, 'channel', 'preview');
    try {
      await enablePushNotifications('user-1');
    } finally {
      channel.restore();
    }

    expect(mockRpc).toHaveBeenCalledWith(
      'sync_push_installation',
      expect.objectContaining({ app_environment: 'preview' }),
    );
  });

  it('aynı anda gelen kayıt taleplerini ve cooldown içindeki tekrarı tek RPC ile sınırlar', async () => {
    const [first, second] = await Promise.all([
      enablePushNotifications('user-1'),
      enablePushNotifications('user-1'),
    ]);
    await enablePushNotifications('user-1');

    expect([first, second]).toEqual([true, true]);
    expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(2);
    expect(
      mockRpc.mock.calls.filter(call => call[0] === 'sync_push_installation'),
    ).toHaveLength(1);
  });

  it('token rotasyonunda yeniyi kaydedip eski tokenı pasifleştirir', async () => {
    getExpoPushTokenAsync
      .mockResolvedValueOnce({
        data: 'ExpoPushToken[token-one]',
        type: 'expo',
      })
      .mockResolvedValueOnce({
        data: 'ExpoPushToken[token-two]',
        type: 'expo',
      });

    await enablePushNotifications('user-1');
    await enablePushNotifications('user-1');

    expect(mockRpc.mock.calls).toEqual([
      [
        'sync_push_installation',
        expect.objectContaining({ expo_token: 'ExpoPushToken[token-one]' }),
      ],
      [
        'sync_push_installation',
        expect.objectContaining({
          expo_token: 'ExpoPushToken[token-two]',
          previous_expo_tokens: ['ExpoPushToken[token-one]'],
        }),
      ],
    ]);
    expect(storageSetItem).toHaveBeenLastCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('ExpoPushToken[token-two]'),
    );
  });

  it('geçersiz Expo tokenını kalıcılaştırmadan reddeder', async () => {
    jest.useFakeTimers();
    getExpoPushTokenAsync.mockResolvedValue({
      data: 'not-an-expo-token',
      type: 'expo',
    });

    await expect(enablePushNotifications('user-1')).rejects.toThrow(
      'Geçersiz Expo push token biçimi.',
    );

    expect(mockRpc).not.toHaveBeenCalled();
    expect(storageSetItem).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('sunucu kayıt hatasında yalnız güvenli kurtarma kaydı bırakır', async () => {
    jest.useFakeTimers();
    const error = new Error('registration denied');
    mockRpc.mockResolvedValueOnce({ data: null, error });

    await expect(enablePushNotifications('user-1')).rejects.toBe(error);

    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"syncState":"pending_registration"'),
    );
    expect(storageSetItem).not.toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"syncState":"registered"'),
    );
    expect(jest.getTimerCount()).toBe(1);
  });

  it('zamanlanmış kayıt tekrarının hatasını telemetriye iletir', async () => {
    jest.useFakeTimers();
    const error = new Error('retry registration denied');
    mockRpc.mockResolvedValue({ data: null, error });

    await expect(enablePushNotifications('user-1')).rejects.toBe(error);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });

    expect(mockCaptureAppError).toHaveBeenCalledWith(error, {
      operation: 'push.registration.retry',
    });
    expect(
      mockRpc.mock.calls.filter(call => call[0] === 'sync_push_installation'),
    ).toHaveLength(2);
  });

  it('izin iptal edildiğinde saklanan kullanıcı tokenını pasifleştirir', async () => {
    storageGetItem.mockImplementation(async key =>
      key === '@etkinlink/push-registration-v2'
        ? storedRegistration()
        : '10000000-0000-4000-8000-000000000001',
    );
    getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    const { unmount } = await renderHook(() => usePushRegistration('user-1'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('revoke_push_installation', {
        client_installation_id: '10000000-0000-4000-8000-000000000001',
        app_environment: 'development',
        expo_token: 'ExponentPushToken[stored-token]',
        revocation_reason: 'permission_denied',
      });
    });
    expect(storageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
    );

    await unmount();
  });

  it('bellekte token olmasa da saklanan tokenı sunucudan ve cihazdan siler', async () => {
    storageGetItem.mockImplementation(async key =>
      key === '@etkinlink/push-registration-v2'
        ? storedRegistration()
        : '10000000-0000-4000-8000-000000000001',
    );

    await unregisterCurrentPushToken();

    expect(mockRpc).toHaveBeenCalledWith('revoke_push_installation', {
      client_installation_id: '10000000-0000-4000-8000-000000000001',
      app_environment: 'development',
      expo_token: 'ExponentPushToken[stored-token]',
      revocation_reason: 'logout',
    });
    expect(storageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
    );
  });

  it('bozuk yerel kaydı token olarak kullanmaz ama güvenle temizler', async () => {
    storageGetItem.mockResolvedValue('{broken-json');

    await unregisterCurrentPushToken();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(storageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
    );
  });

  it('çevrimdışı logout sırasında şifreli tombstone kaydını korur', async () => {
    const error = new Error('offline');
    storageGetItem.mockImplementation(async key =>
      key === '@etkinlink/push-registration-v2'
        ? storedRegistration()
        : '10000000-0000-4000-8000-000000000001',
    );
    mockRpc.mockResolvedValueOnce({ data: null, error });

    await expect(unregisterCurrentPushToken()).rejects.toBe(error);

    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"syncState":"pending_revocation"'),
    );
    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"revocationReason":"logout"'),
    );
    expect(storageRemoveItem).not.toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
    );
  });

  it('session kaybını ağ çağrısı yapmadan güvenli tombstone olarak işaretler', async () => {
    storageGetItem.mockImplementation(async key =>
      key === '@etkinlink/push-registration-v2'
        ? storedRegistration()
        : '10000000-0000-4000-8000-000000000001',
    );

    await tombstoneCurrentPushRegistration('session_loss');

    expect(mockRpc).not.toHaveBeenCalled();
    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"revocationReason":"session_loss"'),
    );
  });

  it('hesap değişiminde önceki güvenli token bağını atomik sync isteğine taşır', async () => {
    storageGetItem.mockImplementation(async key =>
      key === '@etkinlink/push-registration-v2'
        ? storedRegistration({ userId: 'old-user' })
        : '10000000-0000-4000-8000-000000000001',
    );

    await enablePushNotifications('new-user');

    expect(mockRpc).toHaveBeenCalledWith(
      'sync_push_installation',
      expect.objectContaining({
        client_installation_id: '10000000-0000-4000-8000-000000000001',
        previous_expo_tokens: ['ExponentPushToken[stored-token]'],
      }),
    );
    expect(storageSetItem).toHaveBeenLastCalledWith(
      '@etkinlink/push-registration-v2',
      expect.stringContaining('"userId":"new-user"'),
    );
  });

  it('reinstall sonrası güvenli kurulum kaydı yoksa yeni installation ID üretir', async () => {
    mockCreateClientId.mockReturnValueOnce(
      '20000000-0000-4000-8000-000000000002',
    );

    await enablePushNotifications('user-1');

    expect(mockRpc).toHaveBeenCalledWith(
      'sync_push_installation',
      expect.objectContaining({
        client_installation_id: '20000000-0000-4000-8000-000000000002',
      }),
    );
  });

  it('çevrimdışı otomatik tekrarları dört gecikmeli denemeyle sınırlar', async () => {
    jest.useFakeTimers();
    const error = new Error('offline');
    mockRpc.mockResolvedValue({ data: null, error });

    await expect(enablePushNotifications('user-1')).rejects.toBe(error);
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(
      mockRpc.mock.calls.filter(call => call[0] === 'sync_push_installation'),
    ).toHaveLength(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aktif uygulama ve token olaylarında yeniden eşitler, unmount sırasında tüm listenerları temizler', async () => {
    const appRemove = jest.fn();
    const tokenRemove = jest.fn();
    const droppedRemove = jest.fn();
    let appStateListener: ((state: 'active' | 'background') => void) | null =
      null;
    let tokenListener: (() => void) | null = null;
    let droppedListener: (() => void) | null = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener as typeof appStateListener;
        return { remove: appRemove };
      });
    jest
      .mocked(Notifications.addPushTokenListener)
      .mockImplementation(listener => {
        tokenListener = listener as () => void;
        return { remove: tokenRemove };
      });
    jest
      .mocked(Notifications.addNotificationsDroppedListener)
      .mockImplementation(listener => {
        droppedListener = listener;
        return { remove: droppedRemove };
      });

    const { unmount } = await renderHook(() => usePushRegistration('user-1'));
    await waitFor(() => {
      expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
    });

    await act(() => appStateListener?.('background'));
    expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
    await act(() => appStateListener?.('active'));
    await waitFor(() => {
      expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(2);
    });

    await act(() => tokenListener?.());
    await waitFor(() => {
      expect(
        mockRpc.mock.calls.filter(call => call[0] === 'sync_push_installation'),
      ).toHaveLength(2);
    });
    await act(() => droppedListener?.());
    await waitFor(() => {
      expect(
        mockRpc.mock.calls.filter(call => call[0] === 'sync_push_installation'),
      ).toHaveLength(3);
    });

    await unmount();
    expect(appRemove).toHaveBeenCalledTimes(1);
    expect(tokenRemove).toHaveBeenCalledTimes(1);
    expect(droppedRemove).toHaveBeenCalledTimes(1);
  });

  it('başlangıç ve lifecycle olayları izin kararı verilmediyse OS izni istemez', async () => {
    const appRemove = jest.fn();
    let appStateListener: ((state: 'active' | 'background') => void) | null =
      null;
    let tokenListener: (() => void) | null = null;
    let droppedListener: (() => void) | null = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener as typeof appStateListener;
        return { remove: appRemove };
      });
    jest
      .mocked(Notifications.addPushTokenListener)
      .mockImplementation(listener => {
        tokenListener = listener as () => void;
        return { remove: jest.fn() };
      });
    jest
      .mocked(Notifications.addNotificationsDroppedListener)
      .mockImplementation(listener => {
        droppedListener = listener;
        return { remove: jest.fn() };
      });
    getPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    const { unmount } = await renderHook(() => usePushRegistration('user-1'));

    await waitFor(() => {
      expect(getPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    await act(() => appStateListener?.('active'));
    await act(() => tokenListener?.());
    await act(() => droppedListener?.());
    await waitFor(() => {
      expect(getPermissionsAsync).toHaveBeenCalledTimes(4);
    });

    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    await unmount();
  });

  it('listener kaydı başarısızlığını telemetriye iletir', async () => {
    const error = new Error('push backend unavailable');
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    mockRpc.mockResolvedValueOnce({ data: null, error });

    const { unmount } = await renderHook(() => usePushRegistration('user-1'));
    await waitFor(() => {
      expect(mockCaptureAppError).toHaveBeenCalledWith(error, {
        operation: 'push.registration',
      });
    });

    // The provider error can embed the raw Expo push token, so the failure may
    // only reach the console through the redacting telemetry helper.
    expect(mockWarnRedacted).toHaveBeenCalledWith(
      'Push bildirimi kaydı tamamlanamadı.',
      error,
    );
    expect(warning).not.toHaveBeenCalled();
    await unmount();
    warning.mockRestore();
  });

  it('kullanıcı yokken listener veya token kaydı oluşturmaz', async () => {
    await renderHook(() => usePushRegistration(null));

    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(Notifications.addPushTokenListener).not.toHaveBeenCalled();
    expect(
      Notifications.addNotificationsDroppedListener,
    ).not.toHaveBeenCalled();
  });
});

jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => ({ data: null, error: null })),
  },
}));

jest.mock('@shared/lib/telemetry', () => ({
  captureAppError: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import {
  enablePushNotifications,
  ensureNotificationPermission,
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
const storageGetItem = jest.mocked(AsyncStorage.getItem);
const storageRemoveItem = jest.mocked(AsyncStorage.removeItem);
const storageSetItem = jest.mocked(AsyncStorage.setItem);
const mockRpc = supabase.rpc as jest.Mock;
const mockCaptureAppError = jest.mocked(captureAppError);

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

  it('fiziksel cihaz tokenını proje, platform ve sürüm bağlamıyla kaydeder', async () => {
    await expect(enablePushNotifications('user-1')).resolves.toBe(true);

    expect(getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
    });
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      expo_token: 'ExpoPushToken[token-one]',
      token_platform: 'android',
      project_id: 'a47f42fd-67ac-4f93-b6cd-8014abaa3e70',
      app_version: '1.0.0',
    });
    expect(storageSetItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v1',
      JSON.stringify({
        token: 'ExpoPushToken[token-one]',
        userId: 'user-1',
      }),
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
      mockRpc.mock.calls.filter(call => call[0] === 'register_push_token'),
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
        'register_push_token',
        expect.objectContaining({ expo_token: 'ExpoPushToken[token-one]' }),
      ],
      [
        'register_push_token',
        expect.objectContaining({ expo_token: 'ExpoPushToken[token-two]' }),
      ],
      ['unregister_push_token', { expo_token: 'ExpoPushToken[token-one]' }],
    ]);
    expect(storageSetItem).toHaveBeenLastCalledWith(
      '@etkinlink/push-registration-v1',
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

  it('sunucu kayıt hatasında yerel kaydı başarılı gibi güncellemez', async () => {
    jest.useFakeTimers();
    const error = new Error('registration denied');
    mockRpc.mockResolvedValueOnce({ data: null, error });

    await expect(enablePushNotifications('user-1')).rejects.toBe(error);

    expect(storageSetItem).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('bellekte token olmasa da saklanan tokenı sunucudan ve cihazdan siler', async () => {
    storageGetItem.mockResolvedValue(
      JSON.stringify({
        token: 'ExponentPushToken[stored-token]',
        userId: 'user-1',
      }),
    );

    await unregisterCurrentPushToken();

    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', {
      expo_token: 'ExponentPushToken[stored-token]',
    });
    expect(storageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v1',
    );
  });

  it('bozuk yerel kaydı token olarak kullanmaz ama güvenle temizler', async () => {
    storageGetItem.mockResolvedValue('{broken-json');

    await unregisterCurrentPushToken();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(storageRemoveItem).toHaveBeenCalledWith(
      '@etkinlink/push-registration-v1',
    );
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
        mockRpc.mock.calls.filter(call => call[0] === 'register_push_token'),
      ).toHaveLength(2);
    });
    await act(() => droppedListener?.());
    await waitFor(() => {
      expect(
        mockRpc.mock.calls.filter(call => call[0] === 'register_push_token'),
      ).toHaveLength(3);
    });

    await unmount();
    expect(appRemove).toHaveBeenCalledTimes(1);
    expect(tokenRemove).toHaveBeenCalledTimes(1);
    expect(droppedRemove).toHaveBeenCalledTimes(1);
  });

  it('ilk oturumda izin kararı verilmediyse izni ister ve tokenı kaydeder', async () => {
    getPermissionsAsync
      .mockResolvedValueOnce({
        status: 'undetermined',
        granted: false,
        canAskAgain: true,
        expires: 'never',
      } as Notifications.NotificationPermissionsStatus)
      .mockResolvedValue({
        status: 'granted',
        granted: true,
        canAskAgain: true,
        expires: 'never',
      } as Notifications.NotificationPermissionsStatus);
    requestPermissionsAsync.mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    } as Notifications.NotificationPermissionsStatus);

    const { unmount } = await renderHook(() => usePushRegistration('user-1'));

    await waitFor(() => {
      expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith(
        'register_push_token',
        expect.objectContaining({ expo_token: 'ExpoPushToken[token-one]' }),
      );
    });
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

    expect(warning).toHaveBeenCalledWith(
      'Push bildirimi kaydı tamamlanamadı.',
      error,
    );
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

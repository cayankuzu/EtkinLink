import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

const EXPO_PUSH_TOKEN_PATTERN =
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const PUSH_REGISTRATION_STORAGE_KEY = '@etkinlink/push-registration-v1';
const PUSH_SYNC_COOLDOWN_MS = 60_000;
const PUSH_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;
const ANDROID_CHANNELS = {
  messages: 'messages-v2',
  rooms: 'rooms-v2',
  matches: 'matches-v2',
  events: 'events-v2',
  system: 'system-v2',
} as const;

type StoredPushRegistration = {
  token: string;
  userId: string;
};

let currentExpoPushToken: string | null = null;
let currentPushUserId: string | null = null;
let lastPushSyncAt = 0;
let registrationPromise: Promise<string | null> | null = null;
let registrationPromiseUserId: string | null = null;
let permissionPromise: Promise<boolean> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

async function configureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.messages, {
      name: 'Özel mesajlar',
      description: 'Eşleşmelerinden gelen yeni özel mesajlar',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      vibrationPattern: [0, 220, 160, 220],
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.rooms, {
      name: 'Etkinlik odaları',
      description: 'Katıldığın etkinlik odalarındaki yeni mesajlar',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.matches, {
      name: 'Eşleşmeler',
      description: 'Yeni beğeni, eşleşme ve sohbet durumu bildirimleri',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
      vibrationPattern: [0, 220, 120, 220],
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.events, {
      name: 'Etkinlik hatırlatmaları',
      description: 'Katılacağın etkinlikler için zamanında hatırlatmalar',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNELS.system, {
      name: 'EtkinLink duyuruları',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    }),
  ]);
}

function getEasProjectId(): string {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('Expo EAS projectId bulunamadı.');
  }
  return projectId;
}

function allowsNotifications(
  settings: Notifications.NotificationPermissionsStatus,
): boolean {
  if (settings.granted || settings.status === 'granted') return true;
  const iosStatus = settings.ios?.status;
  return (
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

async function requestNotificationPermission(): Promise<boolean> {
  await configureAndroidChannels();

  let permission = await Notifications.getPermissionsAsync();
  if (!allowsNotifications(permission) && permission.canAskAgain !== false) {
    permission = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowProvisional: false,
      },
    });
  }
  return allowsNotifications(permission);
}

export function ensureNotificationPermission(): Promise<boolean> {
  if (permissionPromise) return permissionPromise;
  permissionPromise = requestNotificationPermission().finally(() => {
    permissionPromise = null;
  });
  return permissionPromise;
}

async function readStoredRegistration(): Promise<StoredPushRegistration | null> {
  try {
    const value = await AsyncStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredPushRegistration>;
    if (typeof parsed.token !== 'string' || typeof parsed.userId !== 'string') {
      return null;
    }
    return { token: parsed.token, userId: parsed.userId };
  } catch {
    return null;
  }
}

async function storeRegistration(
  registration: StoredPushRegistration,
): Promise<void> {
  await AsyncStorage.setItem(
    PUSH_REGISTRATION_STORAGE_KEY,
    JSON.stringify(registration),
  );
}

async function removeStoredRegistration(): Promise<void> {
  await AsyncStorage.removeItem(PUSH_REGISTRATION_STORAGE_KEY);
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

function scheduleRetry(userId: string): void {
  if (retryTimer) return;
  const delay =
    PUSH_RETRY_DELAYS_MS[
      Math.min(retryAttempt, PUSH_RETRY_DELAYS_MS.length - 1)
    ];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void registerForPushNotifications(userId).catch(error => {
      captureAppError(error, { operation: 'push.registration.retry' });
    });
  }, delay);
}

async function unregisterToken(token: string): Promise<void> {
  const { error } = await supabase.rpc('unregister_push_token', {
    expo_token: token,
  });
  if (error) throw error;
}

async function deactivateRegistration(userId: string): Promise<void> {
  const stored = await readStoredRegistration();
  const token =
    currentPushUserId === userId
      ? currentExpoPushToken
      : stored?.userId === userId
      ? stored.token
      : null;
  if (!token) return;

  await unregisterToken(token);
  if (stored?.userId === userId && stored.token === token) {
    await removeStoredRegistration();
  }
  currentExpoPushToken = null;
  currentPushUserId = null;
  lastPushSyncAt = 0;
}

async function registerPushToken(userId: string): Promise<string | null> {
  await configureAndroidChannels();
  const permissionGranted = allowsNotifications(
    await Notifications.getPermissionsAsync(),
  );
  if (!permissionGranted) {
    await deactivateRegistration(userId);
    return null;
  }

  const projectId = getEasProjectId();
  const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId }))
    .data;
  if (!EXPO_PUSH_TOKEN_PATTERN.test(expoToken)) {
    throw new Error('Geçersiz Expo push token biçimi.');
  }

  const stored = await readStoredRegistration();
  const previousToken =
    currentPushUserId === userId
      ? currentExpoPushToken
      : stored?.userId === userId
      ? stored.token
      : null;
  if (
    expoToken === previousToken &&
    Date.now() - lastPushSyncAt < PUSH_SYNC_COOLDOWN_MS
  ) {
    return expoToken;
  }

  const { error } = await supabase.rpc('register_push_token', {
    expo_token: expoToken,
    token_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    project_id: projectId,
    app_version: Constants.expoConfig?.version ?? null,
  });
  if (error) throw error;

  if (previousToken && previousToken !== expoToken) {
    await unregisterToken(previousToken).catch(() => undefined);
  }
  await storeRegistration({ token: expoToken, userId });
  currentExpoPushToken = expoToken;
  currentPushUserId = userId;
  lastPushSyncAt = Date.now();
  clearRetry();
  return expoToken;
}

async function registerForPushNotifications(
  userId: string,
): Promise<string | null> {
  if (registrationPromise) {
    if (registrationPromiseUserId === userId) return registrationPromise;
    await registrationPromise.catch(() => undefined);
  }

  const nextPromise = registerPushToken(userId)
    .catch(error => {
      scheduleRetry(userId);
      throw error;
    })
    .finally(() => {
      if (registrationPromise === nextPromise) {
        registrationPromise = null;
        registrationPromiseUserId = null;
      }
    });
  registrationPromise = nextPromise;
  registrationPromiseUserId = userId;
  return nextPromise;
}

export async function enablePushNotifications(
  userId: string,
): Promise<boolean> {
  const permissionGranted = await ensureNotificationPermission();
  if (!permissionGranted) return false;
  return Boolean(await registerForPushNotifications(userId));
}

export async function unregisterCurrentPushToken(): Promise<void> {
  await registrationPromise?.catch(() => undefined);
  const stored = await readStoredRegistration();
  const token = currentExpoPushToken ?? stored?.token ?? null;
  if (token) await unregisterToken(token);
  await removeStoredRegistration();
  clearRetry();
  currentExpoPushToken = null;
  currentPushUserId = null;
  registrationPromiseUserId = null;
  lastPushSyncAt = 0;
}

export function usePushRegistration(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const register = async () => {
      try {
        const permissionGranted = await ensureNotificationPermission();
        if (!permissionGranted) {
          await deactivateRegistration(userId);
          return;
        }
        await registerForPushNotifications(userId);
      } catch (error) {
        if (!cancelled) {
          captureAppError(error, { operation: 'push.registration' });
          console.warn('Push bildirimi kaydı tamamlanamadı.', error);
        }
      }
    };

    void register();
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void register();
    });
    const tokenSubscription = Notifications.addPushTokenListener(() => {
      lastPushSyncAt = 0;
      void register();
    });
    const droppedSubscription = Notifications.addNotificationsDroppedListener(
      () => {
        lastPushSyncAt = 0;
        void register();
      },
    );

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      tokenSubscription.remove();
      droppedSubscription.remove();
      clearRetry();
    };
  }, [userId]);
}

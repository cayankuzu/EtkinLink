import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClientId } from '@shared/lib/ids';
import { secureStorage } from '@shared/lib/secureStorage';
import { supabase } from '@shared/lib/supabase';
import { captureAppError, warnRedacted } from '@shared/lib/telemetry';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

const EXPO_PUSH_TOKEN_PATTERN =
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_PUSH_REGISTRATION_STORAGE_KEY = '@etkinlink/push-registration-v1';
const PUSH_INSTALLATION_STORAGE_KEY = '@etkinlink/push-installation-v1';
const PUSH_REGISTRATION_STORAGE_KEY = '@etkinlink/push-registration-v2';
const PUSH_SYNC_COOLDOWN_MS = 60_000;
const PUSH_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;
const ANDROID_CHANNELS = {
  messages: 'messages-v2',
  rooms: 'rooms-v2',
  matches: 'matches-v2',
  events: 'events-v2',
  system: 'system-v2',
} as const;

type PushPlatform = 'android' | 'ios';
type PushEnvironment = 'development' | 'preview' | 'production';
type PushRevocationReason =
  | 'logout'
  | 'session_loss'
  | 'account_switch'
  | 'permission_denied';
type PushSyncState =
  | 'pending_registration'
  | 'registered'
  | 'pending_revocation';

type StoredPushRegistration = {
  schemaVersion: 2;
  installationId: string;
  token: string;
  userId: string;
  platform: PushPlatform;
  environment: PushEnvironment;
  projectId: string;
  syncState: PushSyncState;
  previousTokens: string[];
  revocationReason?: PushRevocationReason;
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

function getPushPlatform(): PushPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function getPushEnvironment(): PushEnvironment {
  const configuredEnvironment =
    Updates.channel ?? Constants.expoConfig?.extra?.appEnvironment;
  if (
    configuredEnvironment === 'development' ||
    configuredEnvironment === 'preview' ||
    configuredEnvironment === 'production'
  ) {
    return configuredEnvironment;
  }
  return __DEV__ ? 'development' : 'production';
}

function uniqueValidTokens(tokens: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      tokens.filter(
        (token): token is string =>
          typeof token === 'string' && EXPO_PUSH_TOKEN_PATTERN.test(token),
      ),
    ),
  ].slice(0, 2);
}

function isStoredRegistration(
  value: Partial<StoredPushRegistration>,
): value is StoredPushRegistration {
  return (
    value.schemaVersion === 2 &&
    typeof value.installationId === 'string' &&
    UUID_PATTERN.test(value.installationId) &&
    typeof value.token === 'string' &&
    EXPO_PUSH_TOKEN_PATTERN.test(value.token) &&
    typeof value.userId === 'string' &&
    value.userId.length > 0 &&
    (value.platform === 'android' || value.platform === 'ios') &&
    (value.environment === 'development' ||
      value.environment === 'preview' ||
      value.environment === 'production') &&
    typeof value.projectId === 'string' &&
    UUID_PATTERN.test(value.projectId) &&
    (value.syncState === 'pending_registration' ||
      value.syncState === 'registered' ||
      value.syncState === 'pending_revocation') &&
    Array.isArray(value.previousTokens) &&
    value.previousTokens.length <= 2 &&
    value.previousTokens.every(
      token => typeof token === 'string' && EXPO_PUSH_TOKEN_PATTERN.test(token),
    ) &&
    (value.revocationReason === undefined ||
      value.revocationReason === 'logout' ||
      value.revocationReason === 'session_loss' ||
      value.revocationReason === 'account_switch' ||
      value.revocationReason === 'permission_denied')
  );
}

async function purgeLegacyRegistration(): Promise<void> {
  // v1 contained the raw Expo token and user identifier in AsyncStorage.
  // Never read it back into memory: securely re-register from the OS token.
  await AsyncStorage.removeItem(LEGACY_PUSH_REGISTRATION_STORAGE_KEY).catch(
    () => undefined,
  );
}

async function readStoredRegistration(): Promise<StoredPushRegistration | null> {
  await purgeLegacyRegistration();
  try {
    const value = await secureStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredPushRegistration>;
    if (!isStoredRegistration(parsed)) {
      await secureStorage.removeItem(PUSH_REGISTRATION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    await secureStorage
      .removeItem(PUSH_REGISTRATION_STORAGE_KEY)
      .catch(() => undefined);
    return null;
  }
}

async function storeRegistration(
  registration: StoredPushRegistration,
): Promise<void> {
  await secureStorage.setItem(
    PUSH_REGISTRATION_STORAGE_KEY,
    JSON.stringify(registration),
  );
}

async function removeStoredRegistration(): Promise<void> {
  await secureStorage.removeItem(PUSH_REGISTRATION_STORAGE_KEY);
}

async function getOrCreateInstallationId(
  preferredInstallationId?: string,
): Promise<string> {
  const storedInstallationId = await secureStorage.getItem(
    PUSH_INSTALLATION_STORAGE_KEY,
  );
  if (storedInstallationId && UUID_PATTERN.test(storedInstallationId)) {
    return storedInstallationId;
  }
  const installationId =
    preferredInstallationId && UUID_PATTERN.test(preferredInstallationId)
      ? preferredInstallationId
      : createClientId();
  if (!UUID_PATTERN.test(installationId)) {
    throw new Error('Geçerli push kurulum kimliği üretilemedi.');
  }
  await secureStorage.setItem(PUSH_INSTALLATION_STORAGE_KEY, installationId);
  return installationId;
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAttempt = 0;
}

function scheduleRetry(userId: string): void {
  if (retryTimer || retryAttempt >= PUSH_RETRY_DELAYS_MS.length) return;
  const delay = PUSH_RETRY_DELAYS_MS[retryAttempt];
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void registerForPushNotifications(userId).catch(error => {
      captureAppError(error, { operation: 'push.registration.retry' });
    });
  }, delay);
}

async function revokeRegistration(
  registration: StoredPushRegistration,
  reason: PushRevocationReason,
): Promise<void> {
  const { error } = await supabase.rpc('revoke_push_installation', {
    client_installation_id: registration.installationId,
    app_environment: registration.environment,
    expo_token: registration.token,
    revocation_reason: reason,
  });
  if (error) throw error;
}

async function tombstoneRegistration(
  registration: StoredPushRegistration,
  reason: PushRevocationReason,
): Promise<StoredPushRegistration> {
  const tombstone: StoredPushRegistration = {
    ...registration,
    syncState: 'pending_revocation',
    revocationReason: reason,
  };
  await storeRegistration(tombstone);
  return tombstone;
}

function clearRegistrationMemory(): void {
  clearRetry();
  currentExpoPushToken = null;
  currentPushUserId = null;
  registrationPromiseUserId = null;
  lastPushSyncAt = 0;
}

async function deactivateRegistration(
  userId: string,
  reason: PushRevocationReason,
): Promise<void> {
  const stored = await readStoredRegistration();
  if (!stored || stored.userId !== userId) return;

  const tombstone = await tombstoneRegistration(stored, reason);
  clearRegistrationMemory();
  await revokeRegistration(tombstone, reason);
  await removeStoredRegistration();
}

async function registerPushToken(userId: string): Promise<string | null> {
  await configureAndroidChannels();
  const permissionGranted = allowsNotifications(
    await Notifications.getPermissionsAsync(),
  );
  if (!permissionGranted) {
    await deactivateRegistration(userId, 'permission_denied');
    return null;
  }

  const projectId = getEasProjectId();
  const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId }))
    .data;
  if (!EXPO_PUSH_TOKEN_PATTERN.test(expoToken)) {
    throw new Error('Geçersiz Expo push token biçimi.');
  }

  const stored = await readStoredRegistration();
  const installationId = await getOrCreateInstallationId(
    stored?.installationId,
  );
  const platform = getPushPlatform();
  const environment = getPushEnvironment();
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

  const previousTokens = uniqueValidTokens([
    ...(stored?.previousTokens ?? []),
    previousToken !== expoToken ? previousToken : null,
    stored?.token !== expoToken ? stored?.token : null,
  ]);
  const pendingRegistration: StoredPushRegistration = {
    schemaVersion: 2,
    installationId,
    token: expoToken,
    userId,
    platform,
    environment,
    projectId,
    syncState: 'pending_registration',
    previousTokens,
  };

  // Persist the recovery record before the server can activate the token.
  // A crash or lost response can therefore be reconciled on the next start.
  await storeRegistration(pendingRegistration);
  const { error } = await supabase.rpc('sync_push_installation', {
    expo_token: expoToken,
    token_platform: platform,
    project_id: projectId,
    client_installation_id: installationId,
    app_environment: environment,
    app_version: Constants.expoConfig?.version ?? null,
    previous_expo_tokens: previousTokens,
  });
  if (error) throw error;

  await storeRegistration({
    ...pendingRegistration,
    syncState: 'registered',
    previousTokens: [],
  });
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

export async function tombstoneCurrentPushRegistration(
  reason: Extract<PushRevocationReason, 'session_loss' | 'account_switch'>,
): Promise<void> {
  await registrationPromise?.catch(() => undefined);
  const stored = await readStoredRegistration();
  if (stored) await tombstoneRegistration(stored, reason);
  clearRegistrationMemory();
}

export async function unregisterCurrentPushToken(): Promise<void> {
  await registrationPromise?.catch(() => undefined);
  const stored = await readStoredRegistration();
  if (!stored) {
    clearRegistrationMemory();
    return;
  }
  const tombstone = await tombstoneRegistration(stored, 'logout');
  clearRegistrationMemory();
  await revokeRegistration(tombstone, 'logout');
  await removeStoredRegistration();
}

export function usePushRegistration(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const register = async () => {
      try {
        // Lifecycle events may refresh an already-authorized token, but must
        // never surface the OS permission dialog. Permission requests belong
        // exclusively to the existing user-initiated Settings action.
        const permissionGranted = allowsNotifications(
          await Notifications.getPermissionsAsync(),
        );
        if (!permissionGranted) {
          await deactivateRegistration(userId, 'permission_denied');
          return;
        }
        await registerForPushNotifications(userId);
      } catch (error) {
        if (!cancelled) {
          captureAppError(error, { operation: 'push.registration' });
          warnRedacted('Push bildirimi kaydı tamamlanamadı.', error);
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

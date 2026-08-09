import * as Keychain from 'react-native-keychain';

const servicePrefix = 'com.etkinlink.app.supabase';

function serviceForKey(key: string): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `${servicePrefix}.${safeKey}`;
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const credentials = await Keychain.getGenericPassword({
      service: serviceForKey(key),
    });
    return credentials ? credentials.password : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    await Keychain.setGenericPassword('session', value, {
      service: serviceForKey(key),
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  async removeItem(key: string): Promise<void> {
    await Keychain.resetGenericPassword({ service: serviceForKey(key) });
  },
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  PersistedClient,
  Persister,
} from '@tanstack/react-query-persist-client';

const cacheKey = 'etkinlink.public-query-cache.v2';
const restoreTimeoutMs = 350;
const maximumCacheBytes = 1024 * 1024;
const maximumPersistedQueries = 12;
export const queryCacheMaxAgeMs = 24 * 60 * 60_000;
export const queryCacheBuster = 'public-events-v2';

const persistedDomains = new Set([
  'event',
  'event-categories',
  'event-search-index',
  'events',
  'events-preview',
  'interests',
  'registration-interests',
]);
const sensitiveFieldPattern =
  /access|attendeePhoto|email|isSaved|message|password|participation|phone|photoUrl|profile|refresh|saved|secret|session|token|user|viewer/i;

export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && persistedDomains.has(queryKey[0]);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
      sensitiveFieldPattern.test(key) ? [] : [[key, sanitizeValue(nested)]],
    ),
  );
}

function sanitizeClient(client: PersistedClient): PersistedClient {
  const queries = client.clientState.queries
    .filter(query => shouldPersistQueryKey(query.queryKey))
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
    .slice(0, maximumPersistedQueries)
    .map(query => ({
      ...query,
      state: {
        ...query.state,
        data: sanitizeValue(query.state.data),
        error: null,
        fetchFailureReason: null,
        fetchStatus: 'idle' as const,
        status:
          query.state.data === undefined
            ? ('pending' as const)
            : ('success' as const),
      },
    }));
  return {
    ...client,
    clientState: { ...client.clientState, mutations: [], queries },
  };
}

async function readWithTimeout(): Promise<string | null> {
  return Promise.race([
    AsyncStorage.getItem(cacheKey),
    new Promise<null>(resolve =>
      setTimeout(() => resolve(null), restoreTimeoutMs),
    ),
  ]);
}

export const publicQueryPersister: Persister = {
  async persistClient(client) {
    let sanitized = sanitizeClient(client);
    let serialized = JSON.stringify(sanitized);
    while (
      serialized.length > maximumCacheBytes &&
      sanitized.clientState.queries.length > 1
    ) {
      sanitized = {
        ...sanitized,
        clientState: {
          ...sanitized.clientState,
          queries: sanitized.clientState.queries.slice(0, -1),
        },
      };
      serialized = JSON.stringify(sanitized);
    }
    if (serialized.length <= maximumCacheBytes) {
      await AsyncStorage.setItem(cacheKey, serialized);
    }
  },
  async restoreClient() {
    const raw = await readWithTimeout();
    if (!raw || raw.length > maximumCacheBytes) return undefined;
    try {
      return sanitizeClient(JSON.parse(raw) as PersistedClient);
    } catch {
      await AsyncStorage.removeItem(cacheKey);
      return undefined;
    }
  },
  async removeClient() {
    await AsyncStorage.removeItem(cacheKey);
  },
};

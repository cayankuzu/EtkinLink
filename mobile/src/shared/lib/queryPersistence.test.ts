import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  publicQueryPersister,
  shouldPersistQueryKey,
} from './queryPersistence';

describe('kalıcı query cache allowlist', () => {
  it.each([
    { queryKey: ['events'] },
    { queryKey: ['event', 'event-id'] },
    { queryKey: ['event-search-index', 'preview'] },
    { queryKey: ['interests'] },
  ])('kamusal veri alanını kabul eder: $queryKey', ({ queryKey }) => {
    expect(shouldPersistQueryKey(queryKey)).toBe(true);
  });

  it.each([
    { queryKey: ['profile', 'current'] },
    { queryKey: ['direct-messages', 'match-id'] },
    { queryKey: ['rooms'] },
    { queryKey: ['saved-events'] },
  ])('kişisel veri alanını kalıcılaştırmaz: $queryKey', ({ queryKey }) => {
    expect(shouldPersistQueryKey(queryKey)).toBe(false);
  });
});

describe('kalıcı query cache restore timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hızlı storage sonucu sonrası timeout handle bırakmaz', async () => {
    jest.useFakeTimers();
    jest.spyOn(AsyncStorage, 'getItem').mockResolvedValue(null);

    await expect(publicQueryPersister.restoreClient()).resolves.toBeUndefined();

    expect(jest.getTimerCount()).toBe(0);
  });
});

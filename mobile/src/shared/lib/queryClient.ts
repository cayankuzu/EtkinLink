import NetInfo from '@react-native-community/netinfo';
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import { AppState } from 'react-native';

import { captureAppError } from './telemetry';

type RetryableError = {
  status?: number;
  code?: string;
  message?: string;
};

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 2) return false;
  const candidate = error as RetryableError;
  const status = candidate?.status;
  if (
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  ) {
    return true;
  }
  if (status !== undefined && status >= 400) return false;
  return /network|fetch|timeout|temporar|bağlantı/i.test(
    candidate?.message ?? '',
  );
}

export function queryRetryDelay(attempt: number, error: unknown): number {
  const retryAfter = Number((error as { retryAfter?: number })?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1_000, 30_000);
  }
  const jitter = Math.floor(Math.random() * 200);
  return Math.min(500 * 2 ** attempt + jitter, 5_000);
}

onlineManager.setEventListener(setOnline =>
  NetInfo.addEventListener(state => {
    setOnline(
      Boolean(state.isConnected && state.isInternetReachable !== false),
    );
  }),
);

focusManager.setEventListener(handleFocus => {
  const subscription = AppState.addEventListener('change', state => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      captureAppError(error, {
        queryDomain: String(query.queryKey[0] ?? 'unknown'),
      }),
  }),
  mutationCache: new MutationCache({
    onError: error => captureAppError(error, { operation: 'mutation' }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 },
  },
});

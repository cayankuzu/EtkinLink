const defaultRequestTimeoutMs = 15_000;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`İstek ${Math.round(timeoutMs / 1000)} saniye içinde tamamlanamadı.`);
    this.name = 'RequestTimeoutError';
  }
}

export function createTimeoutFetch(
  baseFetch: typeof globalThis.fetch,
  timeoutMs = defaultRequestTimeoutMs,
): typeof globalThis.fetch {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const upstreamSignal = init.signal;
    let timedOut = false;
    const forwardAbort = () => controller.abort();

    if (upstreamSignal?.aborted) controller.abort();
    else
      upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw new RequestTimeoutError(timeoutMs);
      throw error;
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', forwardAbort);
    }
  };
}

export const fetchWithTimeout = createTimeoutFetch(
  globalThis.fetch.bind(globalThis),
);

export function applyAbortSignal<
  TRequest extends { abortSignal: (signal: AbortSignal) => TRequest },
>(request: TRequest, signal?: AbortSignal): TRequest {
  return signal ? request.abortSignal(signal) : request;
}

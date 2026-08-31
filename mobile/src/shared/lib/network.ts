const defaultRequestTimeoutMs = 15_000;

export class ResponseTooLargeError extends Error {
  constructor(public readonly maximumBytes: number) {
    super(`Yanıt izin verilen ${maximumBytes} byte sınırını aştı.`);
    this.name = 'ResponseTooLargeError';
  }
}

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

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    // `for...of` always yields a non-empty Unicode character, so index 0 exists.
    const codePoint = character.codePointAt(0)!;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
        ? 3
        : 4;
  }
  return bytes;
}

export async function readResponseTextLimited(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
  timeoutMs = defaultRequestTimeoutMs,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('maximumBytes pozitif bir safe integer olmalı.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('timeoutMs pozitif bir safe integer olmalı.');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ResponseTooLargeError(maximumBytes);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancellationReject: ((error: Error) => void) | null = null;
  const cancelReader = () => {
    void reader?.cancel().catch(() => undefined);
  };
  const cancellation = new Promise<never>((_resolve, reject) => {
    cancellationReject = reject;
  });
  const forwardAbort = () => {
    cancellationReject?.(abortError());
    cancelReader();
  };
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    cancellationReject?.(new RequestTimeoutError(timeoutMs));
    cancelReader();
  }, timeoutMs);

  const readBody = async (): Promise<string> => {
    if (response.body && typeof TextDecoder !== 'undefined') {
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedBytes = 0;
      let result = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ResponseTooLargeError(maximumBytes);
        }
        result += decoder.decode(chunk.value, { stream: true });
      }
      return result + decoder.decode();
    }

    const text = await response.text();
    if (utf8ByteLength(text) > maximumBytes) {
      throw new ResponseTooLargeError(maximumBytes);
    }
    return text;
  };

  try {
    return await Promise.race([readBody(), cancellation]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

export function parseRetryAfterMs(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

type RetryingGetOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maximumRetryAfterMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

function abortError(): Error {
  const error = new Error('İstek iptal edildi.');
  error.name = 'AbortError';
  return error;
}

function defaultSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export function createRetryingGetFetch(
  baseFetch: typeof globalThis.fetch,
  options: RetryingGetOptions = {},
): typeof globalThis.fetch {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maximumRetryAfterMs = options.maximumRetryAfterMs ?? 30_000;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  return async (input, init = {}) => {
    const requestMethod =
      typeof input === 'object' && input && 'method' in input
        ? String(input.method)
        : 'GET';
    const method = (init.method ?? requestMethod).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      throw new Error(
        'Retry yalnız idempotent GET/HEAD isteklerinde kullanılabilir.',
      );
    }
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
      throw new Error('Retry attempt sayısı 1-5 arasında olmalı.');
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let response: Response;
      try {
        response = await baseFetch(input, init);
      } catch (error) {
        if (init.signal?.aborted || attempt === attempts) throw error;
        const delay = Math.min(
          maximumRetryAfterMs,
          baseDelayMs * 2 ** (attempt - 1) * (0.75 + random() * 0.5),
        );
        await sleep(delay, init.signal ?? undefined);
        continue;
      }

      const retriable = response.status === 429 || response.status >= 500;
      if (!retriable || attempt === attempts) return response;
      const retryAfter = parseRetryAfterMs(
        response.headers.get('retry-after'),
        now(),
      );
      const delay = Math.min(
        maximumRetryAfterMs,
        retryAfter ??
          baseDelayMs * 2 ** (attempt - 1) * (0.75 + random() * 0.5),
      );
      await response.body?.cancel().catch(() => undefined);
      await sleep(delay, init.signal ?? undefined);
    }
    /* istanbul ignore next -- validated finite attempts always return or throw */
    throw new Error('Retry döngüsü beklenmeyen biçimde sonlandı.');
  };
}

export const fetchGetWithRetry = createRetryingGetFetch(fetchWithTimeout);

export function applyAbortSignal<
  TRequest extends { abortSignal: (signal: AbortSignal) => TRequest },
>(request: TRequest, signal?: AbortSignal): TRequest {
  return signal ? request.abortSignal(signal) : request;
}

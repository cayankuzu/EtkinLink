export const EVENTS_API_URL = "https://etkinlik.io/api/v2/events";
export const MAX_UPSTREAM_RESPONSE_BYTES = 2 * 1024 * 1024;

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 10_000;
const ALLOWED_QUERY_PARAMETERS = new Set([
  "skip",
  "sort_by",
  "start_gte",
  "take",
]);

export class UpstreamHttpError extends Error {
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "UpstreamHttpError";
    this.status = status;
  }
}

export type UpstreamHttpDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

export type UpstreamHttpOptions = {
  maxAttempts?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function cancelResponse(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function assertAllowedEventsUrl(input: string | URL): URL {
  let candidate: URL;
  try {
    candidate = new URL(input.toString());
  } catch {
    throw new UpstreamHttpError("UPSTREAM_URL_NOT_ALLOWED");
  }

  const allowed = new URL(EVENTS_API_URL);
  const hasUnexpectedQueryParameter = [...candidate.searchParams.keys()].some(
    (key) => !ALLOWED_QUERY_PARAMETERS.has(key),
  );
  if (
    candidate.protocol !== "https:" ||
    candidate.origin !== allowed.origin ||
    candidate.pathname !== allowed.pathname ||
    candidate.username !== "" ||
    candidate.password !== "" ||
    candidate.hash !== "" ||
    hasUnexpectedQueryParameter
  ) {
    throw new UpstreamHttpError("UPSTREAM_URL_NOT_ALLOWED");
  }

  return candidate;
}

export function parseRetryAfterMs(
  value: string | null,
  nowMs = Date.now(),
): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    return Number.isSafeInteger(seconds) ? seconds * 1000 : null;
  }

  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

export function retryDelayMs(
  retryIndex: number,
  retryAfter: string | null,
  nowMs: number,
  randomValue: number,
): number {
  const requestedDelay = parseRetryAfterMs(retryAfter, nowMs);
  if (requestedDelay !== null) {
    return Math.min(requestedDelay, MAX_RETRY_DELAY_MS);
  }

  const boundedRandom = Math.min(Math.max(randomValue, 0), 1);
  const exponentialCeiling = Math.min(
    BASE_RETRY_DELAY_MS * 2 ** Math.max(retryIndex, 0),
    MAX_RETRY_DELAY_MS,
  );
  return Math.floor(exponentialCeiling * boundedRandom);
}

export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export async function readBoundedJson(
  response: Response,
  maxBytes = MAX_UPSTREAM_RESPONSE_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive integer");
  }
  if (!isJsonContentType(response.headers.get("content-type"))) {
    cancelResponse(response);
    throw new UpstreamHttpError("UPSTREAM_CONTENT_TYPE");
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    if (!/^\d+$/.test(contentLengthHeader.trim())) {
      cancelResponse(response);
      throw new UpstreamHttpError("UPSTREAM_CONTENT_LENGTH");
    }
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
      cancelResponse(response);
      throw new UpstreamHttpError("UPSTREAM_BODY_TOO_LARGE");
    }
  }

  if (!response.body) throw new UpstreamHttpError("UPSTREAM_EMPTY_BODY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamHttpError("UPSTREAM_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new UpstreamHttpError("UPSTREAM_BODY_ENCODING");
  }
  try {
    return JSON.parse(decoded);
  } catch {
    throw new UpstreamHttpError("UPSTREAM_INVALID_JSON");
  }
}

export async function fetchBoundedJson(
  input: string | URL,
  init: RequestInit,
  dependencies: UpstreamHttpDependencies = {},
  options: UpstreamHttpOptions = {},
): Promise<unknown> {
  const url = assertAllowedEventsUrl(input);
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const sleep = dependencies.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ??
    MAX_UPSTREAM_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfter: string | null = null;
    try {
      const response = await fetchImpl(url, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });

      if (isRedirect(response.status)) {
        cancelResponse(response);
        throw new UpstreamHttpError("UPSTREAM_REDIRECT", response.status);
      }

      if (isRetryableStatus(response.status)) {
        retryAfter = response.headers.get("retry-after");
        cancelResponse(response);
        if (attempt === maxAttempts) {
          throw new UpstreamHttpError(
            `UPSTREAM_${response.status}`,
            response.status,
          );
        }
      } else if (!response.ok) {
        cancelResponse(response);
        throw new UpstreamHttpError(
          `UPSTREAM_${response.status}`,
          response.status,
        );
      } else {
        return await readBoundedJson(response, maxResponseBytes);
      }
    } catch (error) {
      if (error instanceof UpstreamHttpError) throw error;
      if (attempt === maxAttempts) {
        throw new UpstreamHttpError(
          controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
    await sleep(retryDelayMs(attempt - 1, retryAfter, now(), random()));
  }

  throw new UpstreamHttpError("UPSTREAM_RETRY_EXHAUSTED");
}

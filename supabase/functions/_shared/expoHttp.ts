import { readBoundedJsonResponse } from "./boundedJson.ts";

const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;

export class ExpoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ExpoHttpError";
  }
}

export function isTransientExpoStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function parseRetryAfterMs(
  header: string | null,
  nowMs = Date.now(),
): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  const dateMs = Date.parse(header);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(Math.max(dateMs - nowMs, 0), MAX_RETRY_AFTER_MS);
}

type FetchJsonOptions = {
  fetch: typeof fetch;
  init: RequestInit;
  maxResponseBytes: number;
  sleep: (delayMs: number) => Promise<void>;
  attempts?: number;
  random?: () => number;
};

function retryDelayMs(
  attempt: number,
  response: Response | null,
  random: () => number,
): number {
  const retryAfter = parseRetryAfterMs(
    response?.headers.get("retry-after") ?? null,
  );
  if (retryAfter !== null) return retryAfter;
  return Math.min(300 * 2 ** attempt + Math.floor(random() * 150), 2_000);
}

export async function fetchExpoJsonWithRetry(
  url: string,
  options: FetchJsonOptions,
): Promise<unknown> {
  const attempts = Math.min(
    Math.max(options.attempts ?? DEFAULT_ATTEMPTS, 1),
    3,
  );
  const random = options.random ?? Math.random;
  let sawNetworkError = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await options.fetch(url, {
        ...options.init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      sawNetworkError = true;
      if (attempt + 1 >= attempts) break;
      await options.sleep(retryDelayMs(attempt, null, random));
      continue;
    }

    let payload: unknown;
    try {
      payload = await readBoundedJsonResponse(
        response,
        options.maxResponseBytes,
      );
    } catch (error) {
      if (isTransientExpoStatus(response.status)) {
        if (attempt + 1 < attempts) {
          await options.sleep(retryDelayMs(attempt, response, random));
          continue;
        }
        throw new ExpoHttpError(
          "Expo geçici HTTP yanıtı geçerli JSON içermiyor.",
          response.status,
        );
      }
      throw error;
    }

    if (response.ok) return payload;
    if (isTransientExpoStatus(response.status) && attempt + 1 < attempts) {
      await options.sleep(retryDelayMs(attempt, response, random));
      continue;
    }
    throw new ExpoHttpError(
      "Expo HTTP isteği başarısız oldu.",
      response.status,
    );
  }

  throw new ExpoHttpError(
    sawNetworkError ? "Expo ağına ulaşılamadı." : "Expo isteği tamamlanamadı.",
    null,
  );
}

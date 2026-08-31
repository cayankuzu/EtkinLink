import type { z } from "zod";

import type { RuntimeConfig } from "./config";
import { responseSchemaForAction, type EventApiRequest } from "./schemas";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 1_000;
const MAX_ATTEMPTS = 3;

export class OriginFailure extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: string | null = null,
    message = "ORIGIN_UNAVAILABLE",
  ) {
    super(message);
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new OriginFailure(502, null, "ORIGIN_CONTENT_TYPE_INVALID");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new OriginFailure(502, null, "ORIGIN_BODY_TOO_LARGE");
  }
  if (!response.body) throw new OriginFailure(502, null, "ORIGIN_BODY_EMPTY");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response limit exceeded");
        throw new OriginFailure(502, null, "ORIGIN_BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new OriginFailure(502, null, "ORIGIN_JSON_INVALID");
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    const parsed = Number.isFinite(seconds) ? seconds * 1_000 : dateDelay;
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed, MAX_RETRY_DELAY_MS);
    }
  }
  const random = new Uint16Array(1);
  crypto.getRandomValues(random);
  return Math.min(
    100 * 2 ** attempt + ((random[0] ?? 0) % 101),
    MAX_RETRY_DELAY_MS,
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(
  request: Request,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("origin timeout");
  }, timeoutMs);
  try {
    const response = await fetch(request, {
      signal: controller.signal,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new OriginFailure(502, null, "ORIGIN_REDIRECT_REJECTED");
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function originUrl(config: RuntimeConfig, functionName: string): URL {
  const base = config.originBaseUrl.toString().replace(/\/?$/, "/");
  const result = new URL(functionName, base);
  if (result.origin !== config.originBaseUrl.origin) {
    throw new Error("ORIGIN_URL_INVALID");
  }
  return result;
}

export async function fetchEventApi(
  config: RuntimeConfig,
  requestId: string,
  authorization: string,
  action: EventApiRequest,
  retryable: boolean,
): Promise<unknown> {
  const body = JSON.stringify(action);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        new Request(originUrl(config, "etkinlik-api"), {
          method: "POST",
          redirect: "manual",
          headers: {
            accept: "application/json",
            authorization,
            "content-type": "application/json; charset=utf-8",
            "x-request-id": requestId,
          },
          body,
        }),
        config.originTimeoutMs,
      );
    } catch (error) {
      if (error instanceof OriginFailure) throw error;
      if (retryable && attempt + 1 < MAX_ATTEMPTS) {
        await wait(retryDelay(new Response(null, { status: 503 }), attempt));
        continue;
      }
      throw new OriginFailure(
        504,
        null,
        error instanceof DOMException && error.name === "AbortError"
          ? "ORIGIN_TIMEOUT"
          : "ORIGIN_NETWORK_ERROR",
      );
    }
    if (
      retryable &&
      RETRYABLE_STATUSES.has(response.status) &&
      attempt + 1 < MAX_ATTEMPTS
    ) {
      const delay = retryDelay(response, attempt);
      await response.body?.cancel();
      await wait(delay);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new OriginFailure(
        response.status,
        response.headers.get("retry-after"),
        "ORIGIN_REJECTED",
      );
    }
    const payload = await readBoundedJson(
      response,
      config.maxOriginResponseBytes,
    );
    const schema: z.ZodType = responseSchemaForAction(action.action);
    const validated = schema.safeParse(payload);
    if (!validated.success) {
      throw new OriginFailure(502, null, "ORIGIN_SCHEMA_INVALID");
    }
    return validated.data;
  }
  throw new OriginFailure(502);
}

export async function triggerIngestion(
  config: RuntimeConfig,
  requestId: string,
  originSecret: string,
  body: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      new Request(originUrl(config, "ingest-events"), {
        method: "POST",
        redirect: "manual",
        headers: {
          accept: "application/json",
          "content-type": "application/json; charset=utf-8",
          "x-cron-secret": originSecret,
          "x-request-id": requestId,
        },
        body,
      }),
      config.originTimeoutMs,
    );
  } catch (error) {
    if (error instanceof OriginFailure) throw error;
    throw new OriginFailure(504, null, "ORIGIN_TIMEOUT");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OriginFailure(
      response.status,
      response.headers.get("retry-after"),
      "ORIGIN_REJECTED",
    );
  }
  return readBoundedJson(response, config.maxOriginResponseBytes);
}

import { runtimeConfig, type RuntimeConfig } from "./config";
import { fetchEventApi, OriginFailure, triggerIngestion } from "./origin";
import { eventApiRequestSchema, type EventApiRequest } from "./schemas";
import {
  bearerToken,
  sha256Hex,
  verifyAccessToken,
  verifyInternalSignature,
} from "./security";

const PUBLIC_BODY_LIMIT_BYTES = 16 * 1024;
const INTERNAL_BODY_LIMIT_BYTES = 2 * 1024;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_DETAIL_PATH = /^\/v1\/events\/([1-9]\d*)$/;

type EventRoute = {
  name: "catalog" | "detail" | "list";
  methods: readonly string[];
};

function eventRoute(pathname: string): EventRoute | null {
  if (pathname === "/v1/events") {
    return { name: "list", methods: ["GET", "HEAD", "POST"] };
  }
  if (EVENT_DETAIL_PATH.test(pathname)) {
    return { name: "detail", methods: ["GET", "HEAD"] };
  }
  if (pathname === "/v1/catalog") {
    return { name: "catalog", methods: ["GET", "HEAD"] };
  }
  return null;
}

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id") ?? "";
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

function baseHeaders(id: string): Headers {
  return new Headers({
    "cache-control": "private, no-store, max-age=0",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-request-id": id,
  });
}

function withCors(
  headers: Headers,
  request: Request,
  config: RuntimeConfig,
): Headers {
  const origin = request.headers.get("origin");
  if (origin && config.allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function json(
  request: Request,
  config: RuntimeConfig,
  id: string,
  status: number,
  payload: unknown,
  extraHeaders?: HeadersInit,
): Response {
  const headers = withCors(baseHeaders(id), request, config);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, name) => {
      headers.set(name, value);
    });
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function corsRejected(request: Request, config: RuntimeConfig): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && !config.allowedOrigins.has(origin);
}

function preflight(
  request: Request,
  config: RuntimeConfig,
  id: string,
  route: EventRoute,
): Response {
  if (corsRejected(request, config)) {
    return json(request, config, id, 403, { error: "Origin reddedildi." });
  }
  const requestedMethod =
    request.headers.get("access-control-request-method")?.toUpperCase() ?? "";
  if (!route.methods.includes(requestedMethod)) {
    return json(request, config, id, 405, { error: "Yöntem desteklenmiyor." });
  }
  const headers = withCors(baseHeaders(id), request, config);
  headers.set(
    "access-control-allow-headers",
    "authorization,content-type,x-request-id",
  );
  headers.set("access-control-allow-methods", route.methods.join(","));
  headers.set("access-control-max-age", "600");
  headers.delete("content-type");
  return new Response(null, { status: 204, headers });
}

async function readTextBounded(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("request limit exceeded");
        throw new Error("REQUEST_BODY_TOO_LARGE");
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
  return new TextDecoder().decode(bytes);
}

function requireJson(request: Request): void {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error("REQUEST_CONTENT_TYPE_INVALID");
  }
}

function singleQuery(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new Error("QUERY_INVALID");
  return values[0] ?? null;
}

function actionFromGet(url: URL, route: EventRoute): EventApiRequest {
  if (route.name === "catalog") return { action: "catalog" };
  if (route.name === "detail") {
    const match = EVENT_DETAIL_PATH.exec(url.pathname);
    return { action: "detail", eventId: Number(match?.[1]) };
  }
  const allowed = new Set([
    "city",
    "formats",
    "startAt",
    "endAt",
    "sort",
    "skip",
    "take",
  ]);
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name)) throw new Error("QUERY_INVALID");
  }
  const formats = (singleQuery(url, "formats") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const raw = {
    action: "list" as const,
    city: singleQuery(url, "city"),
    formats,
    startAt: singleQuery(url, "startAt"),
    endAt: singleQuery(url, "endAt"),
    sort: singleQuery(url, "sort") ?? "upcoming",
    skip: Number(singleQuery(url, "skip") ?? 0),
    take: Number(singleQuery(url, "take") ?? 30),
  };
  return eventApiRequestSchema.parse(raw);
}

async function actionFromPost(request: Request): Promise<EventApiRequest> {
  requireJson(request);
  const text = await readTextBounded(request, PUBLIC_BODY_LIMIT_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("REQUEST_JSON_INVALID");
  }
  return eventApiRequestSchema.parse(value);
}

function safeOriginStatus(status: number): number {
  if ([400, 401, 403, 404, 409, 422, 429].includes(status)) return status;
  return status === 504 ? 504 : 502;
}

function logCompletion(fields: {
  environment: string;
  requestId: string;
  route: string;
  method: string;
  status: number;
  startedAt: number;
  request: Request;
  errorCode?: string;
}): void {
  console.log(
    JSON.stringify({
      event: "edge_request_completed",
      environment: fields.environment,
      request_id: fields.requestId,
      route: fields.route,
      method: fields.method,
      status: fields.status,
      duration_ms: Math.round(performance.now() - fields.startedAt),
      cf_ray: fields.request.headers.get("cf-ray"),
      error_code: fields.errorCode,
    }),
  );
}

async function handleEventRoute(
  request: Request,
  env: Env,
  config: RuntimeConfig,
  id: string,
  route: EventRoute,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token)
    return json(request, config, id, 401, { error: "Geçerli oturum gerekli." });
  let identity;
  try {
    identity = await verifyAccessToken(token, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      jwksUrl: config.jwksUrl,
    });
  } catch {
    return json(request, config, id, 401, { error: "Geçerli oturum gerekli." });
  }
  const rateKey = await sha256Hex(`${identity.sub}\n${route.name}`);
  let rate: RateLimitOutcome;
  try {
    rate = await env.API_RATE_LIMITER.limit({ key: rateKey });
  } catch {
    return json(request, config, id, 503, {
      error: "İstek koruması geçici olarak kullanılamıyor.",
    });
  }
  if (!rate.success) {
    return json(
      request,
      config,
      id,
      429,
      { error: "Çok fazla istek gönderildi." },
      { "retry-after": "60" },
    );
  }
  let action: EventApiRequest;
  try {
    action =
      request.method === "POST"
        ? await actionFromPost(request)
        : actionFromGet(new URL(request.url), route);
  } catch (error) {
    const status =
      error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE"
        ? 413
        : 400;
    return json(request, config, id, status, {
      error: status === 413 ? "İstek gövdesi çok büyük." : "İstek geçersiz.",
    });
  }
  try {
    const payload = await fetchEventApi(
      config,
      id,
      `Bearer ${token}`,
      action,
      request.method === "GET" || request.method === "HEAD",
    );
    const response = json(request, config, id, 200, payload);
    if (request.method === "HEAD") return new Response(null, response);
    return response;
  } catch (error) {
    if (error instanceof OriginFailure) {
      const status = safeOriginStatus(error.status);
      const headers = error.retryAfter
        ? { "retry-after": error.retryAfter }
        : undefined;
      return json(
        request,
        config,
        id,
        status,
        {
          error:
            status === 429
              ? "Çok fazla istek gönderildi."
              : "Etkinlik servisine ulaşılamadı.",
        },
        headers,
      );
    }
    return json(request, config, id, 502, {
      error: "Etkinlik servisine ulaşılamadı.",
    });
  }
}

async function handleIngestion(
  request: Request,
  env: Env,
  config: RuntimeConfig,
  id: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(
      request,
      config,
      id,
      405,
      { error: "Yöntem desteklenmiyor." },
      { allow: "POST" },
    );
  }
  try {
    requireJson(request);
    const body = await readTextBounded(request, INTERNAL_BODY_LIMIT_BYTES);
    const parsed = JSON.parse(body) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length > 0
    ) {
      throw new Error("REQUEST_SCHEMA_INVALID");
    }
    const { nonce } = await verifyInternalSignature(
      request,
      body,
      env.INTERNAL_TRIGGER_HMAC_SECRET,
    );
    const replayKey = await sha256Hex(`ingest\n${nonce}`);
    let replay: RateLimitOutcome;
    try {
      replay = await env.INGEST_RATE_LIMITER.limit({ key: replayKey });
    } catch {
      throw new Error("RATE_LIMIT_UNAVAILABLE");
    }
    if (!replay.success) {
      return json(request, config, id, 409, {
        error: "İstek daha önce işlendi.",
      });
    }
    if (env.ORIGIN_INGEST_SECRET.length < 32)
      throw new Error("ORIGIN_SECRET_INVALID");
    const payload = await triggerIngestion(
      config,
      id,
      env.ORIGIN_INGEST_SECRET,
      body,
    );
    return json(request, config, id, 200, payload);
  } catch (error) {
    if (error instanceof OriginFailure) {
      return json(request, config, id, safeOriginStatus(error.status), {
        error: "İçe aktarma servisine ulaşılamadı.",
      });
    }
    const message = error instanceof Error ? error.message : "UNEXPECTED";
    const status =
      message === "REQUEST_BODY_TOO_LARGE"
        ? 413
        : message === "RATE_LIMIT_UNAVAILABLE"
          ? 503
          : 401;
    return json(request, config, id, status, {
      error:
        status === 413
          ? "İstek gövdesi çok büyük."
          : status === 503
            ? "İstek koruması geçici olarak kullanılamıyor."
            : "Yetkisiz istek.",
    });
  }
}

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const id = requestId(request);
  const startedAt = performance.now();
  let config: RuntimeConfig;
  try {
    config = runtimeConfig(env);
  } catch (error) {
    const headers = baseHeaders(id);
    logCompletion({
      environment: "unknown",
      requestId: id,
      route: "configuration",
      method: request.method,
      status: 500,
      startedAt,
      request,
      errorCode: error instanceof Error ? error.message : "CONFIG_INVALID",
    });
    return new Response(
      JSON.stringify({ error: "Edge yapılandırması geçersiz." }),
      {
        status: 500,
        headers,
      },
    );
  }
  const url = new URL(request.url);
  const route = eventRoute(url.pathname);
  let response: Response;
  if (route && request.method === "OPTIONS") {
    response = preflight(request, config, id, route);
  } else if (url.pathname === "/internal/ingest-events") {
    response = await handleIngestion(request, env, config, id);
  } else if (!route) {
    response = json(request, config, id, 404, {
      error: "Uç nokta bulunamadı.",
    });
  } else if (!route.methods.includes(request.method)) {
    response = json(
      request,
      config,
      id,
      405,
      { error: "Yöntem desteklenmiyor." },
      { allow: route.methods.join(", ") },
    );
  } else if (corsRejected(request, config)) {
    response = json(request, config, id, 403, { error: "Origin reddedildi." });
  } else {
    response = await handleEventRoute(request, env, config, id, route);
  }
  logCompletion({
    environment: config.environment,
    requestId: id,
    route: url.pathname,
    method: request.method,
    status: response.status,
    startedAt,
    request,
  });
  if (request.method === "HEAD" && response.body) {
    return new Response(null, response);
  }
  return response;
}

export default {
  fetch(request, env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

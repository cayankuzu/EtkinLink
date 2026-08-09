import { createClient } from "npm:@supabase/supabase-js@2.112.1";

const API_BASE_URL = "https://etkinlik.io/api/v2";
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const RESPONSE_TTL_MS = 2 * 60 * 1000;
const MAX_TAKE = 50;

type JsonObject = Record<string, unknown>;
type CatalogItem = { id: number; name: string; slug: string };
type Catalog = {
  cities: CatalogItem[];
  formats: CatalogItem[];
  categories: CatalogItem[];
};
type CachedValue = { expiresAt: number; value: unknown };

let catalogCache: { expiresAt: number; value: Catalog } | null = null;
const responseCache = new Map<string, CachedValue>();

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, max-age=60",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, x-client-info, apikey, content-type",
    },
  });
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function secureUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanHtml(value: unknown): string | null {
  const source = text(value);
  if (!source) return null;
  const cleaned = source
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  return cleaned || null;
}

function validDate(value: unknown): string | null {
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function entityName(value: unknown): string | null {
  const name = text(record(value)?.name);
  return name || null;
}

function mapEvent(value: unknown): JsonObject | null {
  const event = record(value);
  const externalId = numberValue(event?.id);
  const title = text(event?.name);
  const startAt = validDate(event?.start_r001 ?? event?.start);
  const sourceUrl = secureUrl(event?.url);
  if (externalId === null || !title || !startAt || !sourceUrl) return null;

  const venueType = text(event?.venue_type).toUpperCase();
  const venueData = record(event?.venue_data);
  const cityData = record(venueData?.city);
  const districtData = record(venueData?.district);
  const registeredVenue = venueType === "VENUE";
  const manualVenue = venueType === "MANUAL";
  const venue =
    entityName(venueData) ?? (venueType === "ONLINE" ? "Çevrim içi" : null);
  const city = registeredVenue
    ? entityName(cityData)
    : manualVenue
      ? text(venueData?.city_name) || null
      : null;
  const district = registeredVenue
    ? entityName(districtData)
    : manualVenue
      ? text(venueData?.district_name) || null
      : null;
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  const categories = [
    entityName(event?.format),
    entityName(event?.category),
    ...tags.map(entityName),
  ].filter((item): item is string => Boolean(item));
  const uniqueCategories = [
    ...new Map(categories.map(item => [normalize(item), item])).values(),
  ];
  const description = cleanHtml(event?.content);

  return {
    id: `etkinlik-io-${externalId}`,
    databaseId: null,
    externalId,
    title,
    summary: description?.slice(0, 500) ?? null,
    description,
    startAt,
    endAt: validDate(event?.end_r001),
    venue,
    city,
    district,
    address: text(venueData?.address) || null,
    imageUrl: secureUrl(event?.poster_url),
    categories: uniqueCategories,
    sourceUrl,
    attendeeCount: 0,
    attendeePhotoUrls: [],
    joined: false,
    saved: false,
    sourceDetails: {
      status: null,
      attendanceMode: venueType || null,
      updatedAt: validDate(event?.modified_at),
      organizer: null,
      performers: [],
      price: null,
      currency: null,
      ticketUrl: secureUrl(event?.ticket_url),
      availability: null,
      ageRange: null,
      isAccessibleForFree:
        typeof event?.is_free === "boolean" ? event.is_free : null,
      doorTime: null,
      duration: null,
    },
  };
}

async function fetchApi(path: string, params?: URLSearchParams): Promise<unknown> {
  const apiToken = Deno.env.get("ETKINLIK_IO_API_TOKEN");
  if (!apiToken) throw new Error("API_TOKEN_MISSING");
  const url = new URL(`${API_BASE_URL}${path}`);
  if (params) url.search = params.toString();
  const cacheKey = url.toString();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Etkinlik-Token": apiToken,
        "User-Agent": "EtkinLink/1.0",
      },
    });
    if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
    const value: unknown = await response.json();
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + RESPONSE_TTL_MS,
      value,
    });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function catalogItems(value: unknown): CatalogItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const itemRecord = record(item);
    const id = numberValue(itemRecord?.id);
    const name = text(itemRecord?.name);
    const slug = text(itemRecord?.slug);
    return id !== null && name ? [{ id, name, slug }] : [];
  });
}

async function getCatalog(): Promise<Catalog> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) {
    return catalogCache.value;
  }
  const [cities, formats, categories] = await Promise.all([
    fetchApi("/cities"),
    fetchApi("/formats"),
    fetchApi("/categories"),
  ]);
  const value = {
    cities: catalogItems(cities),
    formats: catalogItems(formats),
    categories: catalogItems(categories),
  };
  catalogCache = { expiresAt: Date.now() + CATALOG_TTL_MS, value };
  return value;
}

function findIds(catalog: CatalogItem[], names: string[]): number[] {
  const byName = new Map(catalog.map(item => [normalize(item.name), item.id]));
  return [
    ...new Set(
      names.flatMap(name => {
        const id = byName.get(normalize(name));
        return id === undefined ? [] : [id];
      }),
    ),
  ];
}

async function ensureAuthenticated(request: Request): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceRoleKey || !token) return false;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  return !error && Boolean(data.user);
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST desteklenir." });
  }
  if (!(await ensureAuthenticated(request))) {
    return jsonResponse(401, { error: "Geçerli oturum gerekli." });
  }

  try {
    const body = record(await request.json()) ?? {};
    const action = text(body.action) || "list";

    if (action === "catalog") {
      return jsonResponse(200, await getCatalog());
    }

    if (action === "detail") {
      const eventId = numberValue(body.eventId);
      if (eventId === null || eventId < 1) {
        return jsonResponse(400, { error: "Etkinlik kimliği geçersiz." });
      }
      const event = mapEvent(await fetchApi(`/events/${eventId}`));
      return event
        ? jsonResponse(200, { event })
        : jsonResponse(502, { error: "Etkinlik verisi çözümlenemedi." });
    }

    const catalog = await getCatalog();
    const city = text(body.city);
    const formats = Array.isArray(body.formats)
      ? body.formats.map(text).filter(Boolean)
      : [];
    const cityIds = city ? findIds(catalog.cities, [city]) : [];
    const formatIds = findIds(catalog.formats, formats);
    if (city && cityIds.length === 0) {
      return jsonResponse(200, { events: [], total: 0, nextSkip: null });
    }
    if (formats.length > 0 && formatIds.length === 0) {
      return jsonResponse(200, { events: [], total: 0, nextSkip: null });
    }

    const skip = Math.max(0, Math.trunc(numberValue(body.skip) ?? 0));
    const take = Math.min(
      MAX_TAKE,
      Math.max(1, Math.trunc(numberValue(body.take) ?? 30)),
    );
    const params = new URLSearchParams({
      sort_by: text(body.sort) === "recent" ? "recent" : "upcoming",
      skip: String(skip),
      take: String(take),
    });
    if (cityIds.length) params.set("city_ids", cityIds.join(","));
    if (formatIds.length) params.set("format_ids", formatIds.join(","));
    const startAt = text(body.startAt);
    const endAt = text(body.endAt);
    if (startAt) params.set("start_gte", startAt);
    if (endAt) params.set("end_lte", endAt);

    const upstream = record(await fetchApi("/events", params));
    const events = (Array.isArray(upstream?.items) ? upstream.items : [])
      .map(mapEvent)
      .filter((event): event is JsonObject => Boolean(event));
    const total = numberValue(record(upstream?.meta)?.total_count) ?? events.length;
    const consumed = skip + events.length;
    return jsonResponse(200, {
      events,
      total,
      nextSkip: events.length === take && consumed < total ? consumed : null,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "UPSTREAM_429" ? 429 : 502;
    return jsonResponse(status, {
      error:
        code === "API_TOKEN_MISSING"
          ? "Etkinlik.io API yapılandırması eksik."
          : "Etkinlik.io API isteği başarısız.",
      code: code.slice(0, 80),
    });
  }
});

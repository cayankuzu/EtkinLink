import { createClient } from "npm:@supabase/supabase-js@2.112.1";
import { EVENTS_API_URL, fetchBoundedJson } from "./upstreamHttp.ts";

const PAGE_SIZE = 50;
const MAX_EVENTS_PER_RUN = 200;

type JsonObject = Record<string, unknown>;
type EventRow = {
  external_id: number;
  source_guid: string;
  source_url: string;
  title: string;
  summary: string | null;
  description: string | null;
  start_at: string;
  end_at: string | null;
  venue: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  image_url: string;
  categories: string[];
  source_updated_at: string | null;
  is_cancelled: boolean;
  raw_source: Record<string, unknown>;
  ingested_at: string;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
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
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  return cleaned || null;
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

function validDate(value: unknown): string | null {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function entityName(value: unknown): string | null {
  return text(record(value)?.name) || null;
}

function mapEvent(value: unknown, runStartedAt: string): EventRow | null {
  const event = record(value);
  const externalId = numberValue(event?.id);
  const title = text(event?.name);
  const startAt = validDate(event?.start_r001 ?? event?.start);
  const sourceUrl = secureUrl(event?.url);
  const imageUrl = secureUrl(event?.poster_url);
  if (
    externalId === null ||
    !Number.isSafeInteger(externalId) ||
    externalId <= 0 ||
    !title ||
    !startAt ||
    !sourceUrl ||
    !imageUrl
  ) {
    return null;
  }

  const venueType = text(event?.venue_type).toUpperCase();
  const venueData = record(event?.venue_data);
  const registeredVenue = venueType === "VENUE";
  const manualVenue = venueType === "MANUAL";
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  const categories = [
    entityName(event?.format),
    entityName(event?.category),
    ...tags.map(entityName),
  ].filter((item): item is string => Boolean(item));
  const description = cleanHtml(event?.content);
  const endAt = validDate(event?.end_r001);

  return {
    external_id: externalId,
    source_guid: sourceUrl,
    source_url: sourceUrl,
    title: title.slice(0, 180),
    summary: description?.slice(0, 500) ?? null,
    description,
    start_at: startAt,
    end_at: endAt && new Date(endAt).getTime() >= new Date(startAt).getTime()
      ? endAt
      : null,
    venue: entityName(venueData) ??
      (venueType === "ONLINE" ? "Çevrim içi" : null),
    city: registeredVenue
      ? entityName(record(venueData?.city))
      : manualVenue
      ? text(venueData?.city_name) || null
      : null,
    district: registeredVenue
      ? entityName(record(venueData?.district))
      : manualVenue
      ? text(venueData?.district_name) || null
      : null,
    address: text(venueData?.address) || null,
    image_url: imageUrl,
    categories: [...new Set(categories)],
    source_updated_at: validDate(event?.modified_at),
    is_cancelled: false,
    raw_source: {
      provider: "etkinlik.io",
      sync_source: "official-api-v2",
      api_event: event,
    },
    // The run start is a stable fallback version for upstream rows that omit
    // modified_at. Capturing it before any page fetch makes overlapping runs
    // orderable even when an older run reaches the database last.
    ingested_at: runStartedAt,
  };
}

async function fetchPage(skip: number): Promise<{
  items: unknown[];
  total: number;
}> {
  const apiToken = Deno.env.get("ETKINLIK_IO_API_TOKEN");
  if (!apiToken) throw new Error("API_TOKEN_MISSING");
  const params = new URLSearchParams({
    start_gte: new Date().toISOString().slice(0, 19).replace("T", " "),
    sort_by: "updated",
    skip: String(skip),
    take: String(PAGE_SIZE),
  });
  const url = new URL(EVENTS_API_URL);
  url.search = params.toString();
  const payload = record(
    await fetchBoundedJson(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Etkinlik-Token": apiToken,
        "User-Agent": "EtkinLink-EventImporter/2.0",
      },
    }),
  );
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length > PAGE_SIZE) throw new Error("UPSTREAM_PAGE_SIZE");
  const reportedTotal = numberValue(record(payload?.meta)?.total_count);
  return {
    items,
    total: reportedTotal !== null &&
        Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
      ? reportedTotal
      : items.length,
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Yalnızca POST desteklenir." });
  }
  const configuredSecret = Deno.env.get("INGEST_CRON_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-cron-secret") ?? "";
  if (
    configuredSecret.length < 32 ||
    suppliedSecret.length < 32 ||
    !constantTimeEqual(configuredSecret, suppliedSecret)
  ) {
    return jsonResponse(401, { error: "Yetkisiz istek." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: "Sunucu yapılandırması eksik." });
  }

  try {
    const runStartedAt = new Date().toISOString();
    const rawItems: unknown[] = [];
    let total = MAX_EVENTS_PER_RUN;
    for (
      let skip = 0;
      skip < Math.min(total, MAX_EVENTS_PER_RUN);
      skip += PAGE_SIZE
    ) {
      const page = await fetchPage(skip);
      total = page.total;
      rawItems.push(...page.items);
      if (page.items.length < PAGE_SIZE) break;
    }
    const rows = rawItems
      .map((item) => mapEvent(item, runStartedAt))
      .filter((row): row is EventRow => Boolean(row));
    if (rows.length === 0) {
      return jsonResponse(502, { error: "API geçerli etkinlik döndürmedi." });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-etkinlink-worker": "event-ingest-v2" } },
    });
    const uniqueRows = [...new Map(
      rows.map((row) => [row.external_id, row] as const),
    ).values()];
    const { data, error } = await supabase.rpc("ingest_events_batch", {
      event_rows: uniqueRows,
    });
    if (error) throw new Error(`DATABASE_${error.code}`);
    const upserted = Number(data);
    if (upserted !== uniqueRows.length) {
      throw new Error("DATABASE_INVALID_RESULT");
    }
    return jsonResponse(200, {
      source: EVENTS_API_URL,
      received: rawItems.length,
      valid: rows.length,
      upserted,
      completed_at: new Date().toISOString(),
    });
  } catch (error) {
    const code = error instanceof Error
      ? error.message.slice(0, 80)
      : "UNKNOWN";
    return jsonResponse(502, {
      error: "Etkinlik API içe aktarması başarısız.",
      code,
    });
  }
});

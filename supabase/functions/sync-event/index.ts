import { createClient } from "npm:@supabase/supabase-js@2.112.1";

type JsonObject = Record<string, unknown>;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
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

function uniqueNames(values: Array<string | null>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

async function fetchApiEvent(externalId: number): Promise<JsonObject> {
  const apiToken = Deno.env.get("ETKINLIK_IO_API_TOKEN");
  if (!apiToken) throw new Error("API_TOKEN_MISSING");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const apiResponse = await fetch(
      `https://etkinlik.io/api/v2/events/${externalId}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Etkinlik-Token": apiToken,
          "User-Agent": "EtkinLink-EventSync/2.0",
        },
      },
    );
    if (!apiResponse.ok) throw new Error(`UPSTREAM_${apiResponse.status}`);
    const event = record(await apiResponse.json());
    if (!event) throw new Error("INVALID_API_RESPONSE");
    return event;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return response(405, { error: "Yalnızca POST desteklenir." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, { error: "Sunucu yapılandırması eksik." });
  }
  if (!token) return response(401, { error: "Oturum gerekli." });

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !authData.user) {
    return response(401, { error: "Geçersiz oturum." });
  }

  try {
    const body = record(await request.json()) ?? {};
    const sourceUrl = secureUrl(body.source_url);
    const sourceId = sourceUrl
      ? numberValue(
        new URL(sourceUrl).pathname.match(/^\/etkinlik\/(\d+)/)?.[1],
      )
      : null;
    const clientEvent = record(body.event);
    const externalId = sourceId ?? numberValue(clientEvent?.external_id);
    if (externalId === null || externalId < 1) {
      return response(400, { error: "Etkinlik.io etkinlik kimliği geçersiz." });
    }

    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing?.id) return response(200, { event_id: existing.id });

    const apiEvent = await fetchApiEvent(externalId);
    const venueType = text(apiEvent.venue_type).toUpperCase();
    const venueData = record(apiEvent.venue_data);
    const cityData = record(venueData?.city);
    const districtData = record(venueData?.district);
    const registeredVenue = venueType === "VENUE";
    const manualVenue = venueType === "MANUAL";
    const tags = Array.isArray(apiEvent.tags) ? apiEvent.tags : [];
    const categories = uniqueNames([
      entityName(apiEvent.format),
      entityName(apiEvent.category),
      ...tags.map(entityName),
    ]);
    const title = text(apiEvent.name) || text(clientEvent?.title);
    const startAt = validDate(
      apiEvent.start_r001 ?? apiEvent.start ?? clientEvent?.start_at,
    );
    const source = secureUrl(apiEvent.url) ??
      sourceUrl ??
      `https://etkinlik.io/etkinlik/${externalId}`;
    const imageUrl = secureUrl(apiEvent.poster_url) ??
      secureUrl(clientEvent?.image_url);
    if (!title || !startAt || !imageUrl) {
      return response(422, {
        error: "Etkinliğin zorunlu API alanları okunamadı.",
      });
    }

    const description = cleanHtml(apiEvent.content ?? clientEvent?.description);
    const row = {
      external_id: externalId,
      source_guid: source,
      source_url: source,
      title: title.slice(0, 180),
      summary: description?.slice(0, 500) ??
        cleanHtml(clientEvent?.summary)?.slice(0, 500) ?? null,
      description,
      start_at: startAt,
      end_at: validDate(apiEvent.end_r001 ?? clientEvent?.end_at),
      venue: entityName(venueData) ??
        (venueType === "ONLINE"
          ? "Çevrim içi"
          : text(clientEvent?.venue) || null),
      city: registeredVenue
        ? entityName(cityData)
        : manualVenue
        ? text(venueData?.city_name) || null
        : text(clientEvent?.city) || null,
      district: registeredVenue
        ? entityName(districtData)
        : manualVenue
        ? text(venueData?.district_name) || null
        : text(clientEvent?.district) || null,
      address: text(venueData?.address) || text(clientEvent?.address) || null,
      image_url: imageUrl,
      categories,
      source_updated_at: validDate(apiEvent.modified_at),
      is_cancelled: false,
      raw_source: {
        provider: "etkinlik.io",
        sync_source: "official-api-v2",
        api_event: apiEvent,
      },
      ingested_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("events")
      .upsert(row, { onConflict: "external_id" })
      .select("id")
      .single();
    if (error) throw new Error(`DATABASE_${error.code}`);
    return response(200, { event_id: data.id });
  } catch (error) {
    const code = error instanceof Error
      ? error.message.slice(0, 80)
      : "UNKNOWN";
    return response(502, {
      error: "Etkinlik resmi API üzerinden eşitlenemedi.",
      code,
    });
  }
});

import {
  normalizeTurkishSearch,
  TURKISH_CITIES,
} from '@shared/constants/cities';
import type { Event, EventSourceDetails } from '@shared/types/domain';
import {
  addDays,
  endOfWeek,
  isWeekend,
  nextSaturday,
  parseISO,
  startOfDay,
} from 'date-fns';
import { XMLParser } from 'fast-xml-parser';

import type { EventCursor, EventFilters, EventPage } from './eventTypes';

const etkinlikIoRssUrl = 'https://etkinlik.io/rss/sorgu';
const etkinlikIoRssInfoUrl = 'https://etkinlik.io/rss/bilgi';
const rssFeedLimit = 50;
const rssRequestConcurrency = 20;
const rssIdPrefix = 'etkinlik-io-';
let latestEvents: Event[] = [];
const eventCache = new Map<string, Event>();
const feedRequests = new Map<string, Promise<Event[]>>();
const feedCache = new Map<string, { events: Event[]; fetchedAt: number }>();
const feedCacheDurationMs = 10 * 60 * 1000;
let catalogRequest: Promise<RssCatalog> | null = null;
const detailRequests = new Map<string, Promise<Event>>();

function preserveCardState(event: Event): Event {
  const hasFreshState =
    event.databaseId != null ||
    event.attendeeCount > 0 ||
    event.joined ||
    event.saved ||
    Boolean(event.attendeePhotoUrls?.length) ||
    event.roomOpen !== undefined;
  if (hasFreshState) return event;
  const cached =
    eventCache.get(event.id) ??
    latestEvents.find(candidate => candidate.id === event.id);
  if (!cached) return event;
  return {
    ...event,
    databaseId: cached.databaseId ?? event.databaseId,
    attendeeCount: cached.attendeeCount,
    attendeePhotoUrls: cached.attendeePhotoUrls,
    joined: cached.joined,
    saved: cached.saved,
    roomOpen: cached.roomOpen,
  };
}

type RssCatalog = {
  cities: Map<string, string>;
  formats: Map<string, string>;
  categories: Map<string, string>;
  filterLabels: Set<string>;
};

type RssItem = {
  title?: unknown;
  description?: unknown;
  encoded?: unknown;
  pubDate?: unknown;
  link?: unknown;
  guid?: unknown;
  enclosure?: { url?: unknown };
  category?: unknown;
};

type JsonObject = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function firstRecord(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = record(item);
      if (result) return result;
    }
    return null;
  }
  return record(value);
}

function validDate(value: unknown): string | null {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function secureUrl(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (record(candidate)) {
    return (
      secureUrl(record(candidate)?.url) ??
      secureUrl(record(candidate)?.contentUrl)
    );
  }
  if (typeof candidate !== 'string') return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function entityName(value: unknown): string | null {
  if (typeof value === 'string') return text(value) || null;
  const valueRecord = firstRecord(value);
  return valueRecord ? text(valueRecord.name) || null : null;
}

function entityNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(entityName).filter((name): name is string => Boolean(name));
}

function schemaCandidates(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(schemaCandidates);
  const valueRecord = record(value);
  if (!valueRecord) return [];
  const graph = valueRecord['@graph'];
  return graph ? [valueRecord, ...schemaCandidates(graph)] : [valueRecord];
}

function isEventSchema(value: JsonObject): boolean {
  const types = Array.isArray(value['@type'])
    ? value['@type'].map(text)
    : [text(value['@type'])];
  return types.some(type => type.toLowerCase() === 'event');
}

function parseSchemaEvent(html: string): JsonObject | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    try {
      const parsed: unknown = JSON.parse(match[1]?.trim() ?? '');
      const event = schemaCandidates(parsed).find(isEventSchema);
      if (event) return event;
    } catch {
      // A malformed third-party JSON-LD block must not hide the RSS event.
    }
  }
  return null;
}

function sourceDetails(schema: JsonObject): EventSourceDetails {
  const offers = firstRecord(schema.offers);
  const numericPrice = offers?.price;
  const price =
    typeof numericPrice === 'number'
      ? String(numericPrice)
      : text(numericPrice) || null;
  return {
    status: text(schema.eventStatus) || null,
    attendanceMode: text(schema.eventAttendanceMode) || null,
    updatedAt: validDate(schema.dateModified),
    organizer: entityName(schema.organizer),
    performers: entityNames(schema.performer),
    price,
    currency: text(offers?.priceCurrency) || null,
    ticketUrl: secureUrl(offers?.url),
    availability: text(offers?.availability) || null,
    ageRange: text(schema.typicalAgeRange) || null,
    isAccessibleForFree:
      typeof schema.isAccessibleForFree === 'boolean'
        ? schema.isAccessibleForFree
        : null,
    doorTime: validDate(schema.doorTime),
    duration: text(schema.duration) || null,
  };
}

export function parseEtkinlikIoDetailHtml(html: string, base: Event): Event {
  const schema = parseSchemaEvent(html);
  if (!schema) return base;
  const location = firstRecord(schema.location);
  const address = firstRecord(location?.address);
  return {
    ...base,
    title: text(schema.name) || base.title,
    description: cleanHtml(text(schema.description)) || base.description,
    startAt: validDate(schema.startDate) ?? base.startAt,
    endAt: validDate(schema.endDate) ?? base.endAt,
    venue: text(location?.name) || base.venue,
    city: text(address?.addressRegion) || base.city,
    district: text(address?.addressLocality) || base.district,
    address: text(address?.streetAddress) || base.address,
    imageUrl: secureUrl(schema.image) ?? base.imageUrl,
    sourceDetails: sourceDetails(schema),
  };
}

function cleanHtml(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function stableFallbackId(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
  }
  return hash;
}

function findCity(content: string): string | null {
  const normalized = normalizeTurkishSearch(content);
  return (
    TURKISH_CITIES.find(city =>
      normalized.includes(normalizeTurkishSearch(city)),
    ) ?? null
  );
}

export function inferEventCity(event: Event): string | null {
  const city = event.city?.trim();
  if (city) return city;
  return findCity(
    [
      event.title,
      event.summary,
      event.description,
      event.venue,
      event.district,
      event.address,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function categories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const unique = new Map<string, string>();
  for (const item of values) {
    const label = cleanHtml(text(item));
    if (!label) continue;
    const key = normalizeTurkishSearch(label);
    if (!unique.has(key)) unique.set(key, label);
  }
  return [...unique.values()];
}

function parseRssCatalog(html: string): RssCatalog {
  const catalog: RssCatalog = {
    cities: new Map(),
    formats: new Map(),
    categories: new Map(),
    filterLabels: new Set(),
  };
  const inputs = html.matchAll(
    /name=["'](sehir|tur|kategori)\[\d+\]["'][^>]*value=["'](\d+)["'][\s\S]{0,350}?<span>([^<]+)<\/span>/gi,
  );
  for (const match of inputs) {
    const group = match[1];
    const id = match[2];
    const label = cleanHtml(match[3] ?? '');
    if (!group || !id || !label) continue;
    const normalized = normalizeTurkishSearch(label);
    if (group === 'sehir') catalog.cities.set(normalized, id);
    if (group === 'tur') {
      catalog.formats.set(normalized, id);
      catalog.filterLabels.add(label);
    }
    if (group === 'kategori') {
      catalog.categories.set(normalized, id);
      catalog.filterLabels.add(label);
    }
  }
  return catalog;
}

async function getRssCatalog(): Promise<RssCatalog> {
  if (catalogRequest) return catalogRequest;
  catalogRequest = fetch(etkinlikIoRssInfoUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  }).then(async response => {
    if (!response.ok) throw new Error('RSS filtre kataloğu yüklenemedi.');
    return parseRssCatalog(await response.text());
  });
  try {
    return await catalogRequest;
  } catch (error) {
    catalogRequest = null;
    throw error;
  }
}

function rssUrlsForCatalog(
  filters: EventFilters,
  catalog: RssCatalog,
): string[] {
  const cityId = filters.city
    ? catalog.cities.get(normalizeTurkishSearch(filters.city))
    : null;
  if (filters.city && !cityId) {
    throw new Error(
      `Etkinlik.io RSS şehir filtresinde “${filters.city}” bulunamadı. Tüm şehirlerden veri çekilmedi.`,
    );
  }
  const withCity = (params: URLSearchParams) => {
    if (cityId) params.set('sehirIds', cityId);
    const query = params.toString();
    return query ? `${etkinlikIoRssUrl}?${query}` : etkinlikIoRssUrl;
  };
  if (filters.categories.length === 0) {
    const formatIds = [...new Set(catalog.formats.values())];
    const categoryIds = [...new Set(catalog.categories.values())];
    if (formatIds.length + categoryIds.length === 0) {
      throw new Error('Etkinlik.io RSS filtre kataloğu boş döndü.');
    }
    return [
      withCity(new URLSearchParams()),
      ...formatIds.map(id => withCity(new URLSearchParams({ turIds: id }))),
      ...categoryIds.map(id =>
        withCity(new URLSearchParams({ kategoriIds: id })),
      ),
    ];
  }
  const urls = new Set<string>();
  for (const selectedCategory of filters.categories) {
    const normalized = normalizeTurkishSearch(selectedCategory);
    const formatId = catalog.formats.get(normalized);
    const categoryId = catalog.categories.get(normalized);
    let matched = false;
    if (formatId) {
      urls.add(withCity(new URLSearchParams({ turIds: formatId })));
      matched = true;
    }
    if (categoryId) {
      urls.add(withCity(new URLSearchParams({ kategoriIds: categoryId })));
      matched = true;
    }
    if (normalized === 'tiyatro') {
      const stageId = catalog.formats.get('sahne sanatlari');
      if (stageId) {
        urls.add(withCity(new URLSearchParams({ turIds: stageId })));
        matched = true;
      }
    }
    if (!matched) {
      throw new Error(
        `Etkinlik.io RSS kategori filtresinde “${selectedCategory}” bulunamadı. Daha geniş bir sorgu çalıştırılmadı.`,
      );
    }
  }
  return [...urls];
}

export function buildEtkinlikIoRssUrls(
  filters: EventFilters,
  catalogHtml: string,
): string[] {
  return rssUrlsForCatalog(filters, parseRssCatalog(catalogHtml));
}

function partitionRssUrl(url: string, catalog: RssCatalog): string[] {
  const parsed = new URL(url);
  const formatId = parsed.searchParams.get('turIds');
  const categoryId = parsed.searchParams.get('kategoriIds');
  if ((formatId && categoryId) || (!formatId && !categoryId)) return [];
  const cityId = parsed.searchParams.get('sehirIds');
  const partitionIds = formatId
    ? new Set(catalog.categories.values())
    : new Set(catalog.formats.values());
  return [...partitionIds].map(partitionId => {
    const params = new URLSearchParams({
      turIds: formatId ?? partitionId,
      kategoriIds: categoryId ?? partitionId,
    });
    if (cityId) params.set('sehirIds', cityId);
    return `${etkinlikIoRssUrl}?${params.toString()}`;
  });
}

export function buildEtkinlikIoRssPartitionUrls(
  url: string,
  catalogHtml: string,
): string[] {
  return partitionRssUrl(url, parseRssCatalog(catalogHtml));
}

async function filteredRssUrls(filters?: EventFilters): Promise<string[]> {
  if (!filters) return [etkinlikIoRssUrl];
  return rssUrlsForCatalog(filters, await getRssCatalog());
}

function itemToEvent(item: RssItem): Event | null {
  const title = text(item.title);
  const sourceUrl = text(item.link) || text(item.guid);
  const date = new Date(text(item.pubDate));
  if (!title || !sourceUrl || Number.isNaN(date.getTime())) return null;

  const sourceId = sourceUrl.match(/\/etkinlik\/(\d+)(?:\/|$)/)?.[1];
  const externalId = sourceId ? Number(sourceId) : stableFallbackId(sourceUrl);
  const summary = cleanHtml(text(item.description));
  const description = cleanHtml(text(item.encoded)) || summary;
  const eventCategories = categories(item.category);
  const searchable = `${title} ${summary} ${description}`;

  return {
    id: `${rssIdPrefix}${externalId}`,
    externalId,
    title,
    summary: summary || null,
    description: description || null,
    startAt: date.toISOString(),
    endAt: null,
    venue: null,
    city: findCity(searchable),
    district: null,
    address: null,
    imageUrl: text(item.enclosure?.url) || null,
    categories: eventCategories,
    sourceUrl,
    attendeeCount: 0,
    joined: false,
    saved: false,
  };
}

export function parseEtkinlikIoRss(xml: string): Event[] {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    trimValues: true,
  }).parse(xml) as {
    rss?: { channel?: { item?: RssItem | RssItem[] } };
  };
  const rawItems = parsed.rss?.channel?.item;
  const items = rawItems
    ? Array.isArray(rawItems)
      ? rawItems
      : [rawItems]
    : [];
  return items.flatMap(item => {
    const event = itemToEvent(item);
    return event ? [event] : [];
  });
}

async function fetchRssUrl(url: string): Promise<Event[]> {
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < feedCacheDurationMs) {
    return cached.events;
  }
  const activeRequest = feedRequests.get(url);
  if (activeRequest) return activeRequest;
  const request = fetch(url, {
    headers: { Accept: 'application/rss+xml, application/xml;q=0.9' },
  })
    .then(async response => {
      if (!response.ok) {
        throw new Error(
          `Etkinlik.io RSS isteği başarısız (${response.status}).`,
        );
      }
      const events = parseEtkinlikIoRss(await response.text());
      events.forEach(event =>
        eventCache.set(event.id, preserveCardState(event)),
      );
      feedCache.set(url, { events, fetchedAt: Date.now() });
      return events;
    })
    .finally(() => {
      feedRequests.delete(url);
    });
  feedRequests.set(url, request);
  return request;
}

async function fetchRssUrlSet(urls: string[]): Promise<{
  feeds: Map<string, Event[]>;
  firstError: unknown;
}> {
  const feeds = new Map<string, Event[]>();
  let firstError: unknown = null;
  for (let index = 0; index < urls.length; index += rssRequestConcurrency) {
    const chunk = urls.slice(index, index + rssRequestConcurrency);
    const results = await Promise.allSettled(chunk.map(fetchRssUrl));
    results.forEach((result, resultIndex) => {
      const url = chunk[resultIndex];
      if (!url) return;
      if (result.status === 'fulfilled') feeds.set(url, result.value);
      else firstError ??= result.reason;
    });
  }
  return { feeds, firstError };
}

async function fetchRssEvents(filters?: EventFilters): Promise<Event[]> {
  const urls = await filteredRssUrls(filters);
  const initial = await fetchRssUrlSet(urls);
  const feeds = initial.feeds;
  let firstError = initial.firstError;
  const saturatedUrls = urls.filter(
    url => feeds.get(url)?.length === rssFeedLimit,
  );
  if (saturatedUrls.length > 0) {
    const catalog = await getRssCatalog();
    const existingUrls = new Set(urls);
    const partitionUrls = [
      ...new Set(saturatedUrls.flatMap(url => partitionRssUrl(url, catalog))),
    ].filter(url => !existingUrls.has(url));
    const partitions = await fetchRssUrlSet(partitionUrls);
    for (const [url, events] of partitions.feeds) feeds.set(url, events);
    firstError ??= partitions.firstError;
  }
  const merged = new Map<string, Event>();
  for (const feed of feeds.values()) {
    for (const event of feed) merged.set(event.id, event);
  }
  const events = [...merged.values()].map(event =>
    filters?.city ? { ...event, city: filters.city } : event,
  );
  if (events.length === 0) {
    if (firstError) throw firstError;
    throw new Error('Etkinlik.io RSS yanıtında etkinlik bulunamadı.');
  }
  latestEvents = events;
  return events;
}

async function fetchRssEventPreview(filters: EventFilters): Promise<Event[]> {
  const urls = await filteredRssUrls(filters);
  const previewUrls = filters.categories.length > 0 ? urls : urls.slice(0, 1);
  const { feeds, firstError } = await fetchRssUrlSet(previewUrls);
  const merged = new Map<string, Event>();
  for (const feed of feeds.values()) {
    for (const event of feed) merged.set(event.id, event);
  }
  const events = [...merged.values()].map(event =>
    filters.city ? { ...event, city: filters.city } : event,
  );
  if (events.length === 0) {
    if (firstError) throw firstError;
    throw new Error('Etkinlik.io RSS yanıtında etkinlik bulunamadı.');
  }
  const latestById = new Map(latestEvents.map(event => [event.id, event]));
  for (const event of events) latestById.set(event.id, event);
  latestEvents = [...latestById.values()];
  return events;
}

export function clearRssFeedCache(): void {
  feedCache.clear();
}

function matchesCategory(event: Event, category: string): boolean {
  const selected = normalizeTurkishSearch(category);
  const values = event.categories.map(normalizeTurkishSearch);
  if (values.some(value => value === selected)) return true;
  if (selected === 'tiyatro') {
    return values.some(
      value => value.includes('sahne sanatlari') || value.includes('tiyatro'),
    );
  }
  return false;
}

function matchesDate(event: Event, filter: EventFilters['date']): boolean {
  const eventDate = new Date(event.startAt);
  const now = new Date();
  if (filter === 'today') {
    const start = startOfDay(now);
    return eventDate >= start && eventDate < addDays(start, 1);
  }
  if (filter === 'weekend') {
    const start = isWeekend(now)
      ? startOfDay(now)
      : startOfDay(nextSaturday(now));
    const end = addDays(startOfDay(endOfWeek(start, { weekStartsOn: 1 })), 1);
    return eventDate >= start && eventDate < end;
  }
  if (filter.startsWith('range:')) {
    const [startValue, endValue] = filter.slice('range:'.length).split(':');
    if (!startValue || !endValue) return false;
    const start = startOfDay(parseISO(startValue));
    const end = addDays(startOfDay(parseISO(endValue)), 1);
    return (
      !Number.isNaN(start.getTime()) &&
      !Number.isNaN(end.getTime()) &&
      start < end &&
      eventDate >= start &&
      eventDate < end
    );
  }
  return true;
}

export function applyRssFilters(
  events: Event[],
  filters: EventFilters,
): Event[] {
  const query = normalizeTurkishSearch(filters.query.trim());
  const city = filters.city ? normalizeTurkishSearch(filters.city) : null;
  return events
    .filter(event => {
      const searchable = normalizeTurkishSearch(
        [
          event.title,
          event.summary,
          event.description,
          event.venue,
          event.city,
          event.district,
          event.address,
          ...event.categories,
        ]
          .filter(Boolean)
          .join(' '),
      );
      return (
        (!query || searchable.includes(query)) &&
        (!city || normalizeTurkishSearch(event.city ?? '') === city) &&
        (filters.categories.length === 0 ||
          filters.categories.some(category =>
            matchesCategory(event, category),
          )) &&
        matchesDate(event, filters.date)
      );
    })
    .sort((left, right) => {
      const difference =
        new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
      return filters.sort === 'newest' ? -difference : difference;
    });
}

export async function loadUniversalRssPreview(): Promise<Event[]> {
  const events = await fetchRssUrl(etkinlikIoRssUrl);
  const merged = new Map(
    [...latestEvents, ...events].map(event => [event.id, event]),
  );
  latestEvents = [...merged.values()];
  return events;
}

export async function loadUniversalRssBroadIndex(): Promise<Event[]> {
  const filters: EventFilters = {
    query: '',
    city: null,
    categories: [],
    date: 'all',
    sort: 'upcoming',
  };
  const { feeds, firstError } = await fetchRssUrlSet(
    await filteredRssUrls(filters),
  );
  const merged = new Map<string, Event>();
  for (const feed of feeds.values()) {
    for (const event of feed) merged.set(event.id, event);
  }
  const events = [...merged.values()];
  if (events.length === 0) {
    if (firstError) throw firstError;
    throw new Error('Etkinlik.io RSS yanıtında etkinlik bulunamadı.');
  }
  latestEvents = events;
  return events;
}

export async function loadUniversalRssIndex(): Promise<Event[]> {
  return fetchRssEvents({
    query: '',
    city: null,
    categories: [],
    date: 'all',
    sort: 'upcoming',
  });
}

export async function listRssCategories(): Promise<string[]> {
  const unique = new Map<string, string>();
  for (const label of (await getRssCatalog()).filterLabels) {
    const key = normalizeTurkishSearch(label);
    if (!unique.has(key)) unique.set(key, label);
  }
  const values = [...unique.values()];
  return values.sort((left, right) => left.localeCompare(right, 'tr-TR'));
}

export async function searchRssEvents(
  filters: EventFilters,
  _cursor: EventCursor | null,
): Promise<EventPage> {
  return createRssEventPage(await fetchRssEvents(filters), filters);
}

export async function searchRssEventsPreview(
  filters: EventFilters,
): Promise<EventPage> {
  return createRssEventPage(await fetchRssEventPreview(filters), filters);
}

export function createRssEventPage(
  events: Event[],
  filters: EventFilters,
): EventPage {
  return {
    items: applyRssFilters(events, filters),
    nextCursor: null,
  };
}

export async function getRssEvent(eventId: string): Promise<Event> {
  const event = await getRssEventPreview(eventId);
  if (!event) throw new Error('Etkinlik RSS akışında bulunamadı.');
  const existing = detailRequests.get(eventId);
  if (existing) return existing;
  const request = fetch(event.sourceUrl, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  })
    .then(async response => {
      if (!response.ok) return event;
      const enriched = parseEtkinlikIoDetailHtml(await response.text(), event);
      latestEvents = latestEvents.map(item =>
        item.id === eventId ? enriched : item,
      );
      eventCache.set(eventId, enriched);
      return enriched;
    })
    .catch(() => event);
  detailRequests.set(eventId, request);
  return request;
}

export function cacheRssEvents(events: Event[]): void {
  const merged = new Map(latestEvents.map(event => [event.id, event]));
  for (const event of events) {
    const next = preserveCardState(event);
    eventCache.set(next.id, next);
    merged.set(next.id, next);
  }
  latestEvents = [...merged.values()];
}

export function getCachedRssEvent(eventId: string): Event | undefined {
  return (
    eventCache.get(eventId) ?? latestEvents.find(event => event.id === eventId)
  );
}

export async function getRssEventPreview(eventId: string): Promise<Event> {
  const cached = getCachedRssEvent(eventId);
  const event =
    cached ?? (await fetchRssEvents()).find(item => item.id === eventId);
  if (!event) throw new Error('Etkinlik RSS akışında bulunamadı.');
  return event;
}

export function isRssEventId(eventId: string): boolean {
  return eventId.startsWith(rssIdPrefix);
}

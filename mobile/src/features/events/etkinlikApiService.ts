import { normalizeTurkishSearch } from '@shared/constants/cities';
import { supabase } from '@shared/lib/supabase';
import type { Event } from '@shared/types/domain';
import {
  endOfDay,
  endOfWeek,
  format,
  isWeekend,
  nextSaturday,
  parseISO,
  startOfDay,
} from 'date-fns';

import type { EventCursor, EventFilters, EventPage } from './eventTypes';

const eventCache = new Map<string, Event>();
const requests = new Map<string, Promise<ApiListResponse>>();

type ApiListResponse = {
  events: Event[];
  total: number;
  nextSkip: number | null;
};

type ApiCatalogResponse = {
  formats: Array<{ id: number; name: string; slug: string }>;
};

function apiDate(value: Date): string {
  return format(value, 'yyyy-MM-dd HH:mm:ss');
}

function dateRange(date: EventFilters['date']): {
  startAt: string | null;
  endAt: string | null;
} {
  const now = new Date();
  if (date === 'today') {
    return { startAt: apiDate(startOfDay(now)), endAt: apiDate(endOfDay(now)) };
  }
  if (date === 'weekend') {
    const start = isWeekend(now)
      ? startOfDay(now)
      : startOfDay(nextSaturday(now));
    return {
      startAt: apiDate(start),
      endAt: apiDate(endOfDay(endOfWeek(start, { weekStartsOn: 1 }))),
    };
  }
  if (date.startsWith('range:')) {
    const [startValue, endValue] = date.slice('range:'.length).split(':');
    const start = startValue ? parseISO(startValue) : new Date(Number.NaN);
    const end = endValue ? parseISO(endValue) : new Date(Number.NaN);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return {
        startAt: apiDate(startOfDay(start)),
        endAt: apiDate(endOfDay(end)),
      };
    }
  }
  return { startAt: null, endAt: null };
}

async function invokeApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('etkinlik-api', {
    body,
  });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const payload = (await context.clone().json()) as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error.trim()) {
          throw new Error(payload.error.trim());
        }
      } catch (contextError) {
        if (contextError instanceof Error && contextError !== error) {
          throw contextError;
        }
      }
    }
    throw error;
  }
  if (!data) throw new Error('Etkinlik.io API boş yanıt döndürdü.');
  return data;
}

function cacheEvents(events: Event[]): Event[] {
  for (const event of events) eventCache.set(event.id, event);
  return events;
}

function matchesQuery(event: Event, query: string): boolean {
  const normalizedQuery = normalizeTurkishSearch(query.trim());
  if (!normalizedQuery) return true;
  return normalizeTurkishSearch(
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
  ).includes(normalizedQuery);
}

async function listApiPage(
  filters: EventFilters,
  skip: number,
  take: number,
): Promise<ApiListResponse> {
  const range = dateRange(filters.date);
  const body = {
    action: 'list',
    city: filters.city,
    formats: filters.categories,
    startAt: range.startAt,
    endAt: range.endAt,
    sort: filters.sort === 'newest' ? 'recent' : 'upcoming',
    skip,
    take,
  };
  const key = JSON.stringify(body);
  const existing = requests.get(key);
  if (existing) return existing;
  const request = invokeApi<ApiListResponse>(body).finally(() => {
    requests.delete(key);
  });
  requests.set(key, request);
  const response = await request;
  return { ...response, events: cacheEvents(response.events) };
}

export async function searchApiEvents(
  filters: EventFilters,
  cursor: EventCursor | null = null,
  take = 30,
): Promise<EventPage> {
  const response = await listApiPage(filters, cursor?.offset ?? 0, take);
  return {
    items: response.events.filter(event => matchesQuery(event, filters.query)),
    nextCursor:
      response.nextSkip === null ? null : { offset: response.nextSkip },
  };
}

export async function getApiEvent(eventId: string): Promise<Event> {
  const cached = eventCache.get(eventId);
  if (cached?.description && cached.sourceDetails) return cached;
  const externalId = Number(eventId.replace(/^etkinlik-io-/, ''));
  if (!Number.isInteger(externalId) || externalId < 1) {
    throw new Error('Etkinlik.io etkinlik kimliği geçersiz.');
  }
  const response = await invokeApi<{ event: Event }>({
    action: 'detail',
    eventId: externalId,
  });
  eventCache.set(response.event.id, response.event);
  return response.event;
}

export function getCachedApiEvent(eventId: string): Event | undefined {
  return eventCache.get(eventId);
}

export function cacheApiEvents(events: Event[]): void {
  cacheEvents(events);
}

export function clearApiEventCache(): void {
  requests.clear();
}

export async function listApiEventCategories(): Promise<string[]> {
  const catalog = await invokeApi<ApiCatalogResponse>({ action: 'catalog' });
  return catalog.formats
    .map(item => item.name)
    .sort((left, right) => left.localeCompare(right, 'tr-TR'));
}

const universalFilters: EventFilters = {
  query: '',
  city: null,
  categories: [],
  date: 'all',
  sort: 'upcoming',
};

export async function loadUniversalApiPreview(): Promise<Event[]> {
  return (await listApiPage(universalFilters, 0, 30)).events;
}

export async function loadUniversalApiIndex(): Promise<Event[]> {
  return (await listApiPage(universalFilters, 0, 50)).events;
}

export async function loadUniversalApiBroadIndex(): Promise<Event[]> {
  const first = await listApiPage(universalFilters, 0, 50);
  const pageCount = Math.min(6, Math.ceil(first.total / 50));
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      listApiPage(universalFilters, (index + 1) * 50, 50),
    ),
  );
  return cacheEvents([
    ...new Map(
      [first, ...remaining]
        .flatMap(page => page.events)
        .map(event => [event.id, event]),
    ).values(),
  ]);
}

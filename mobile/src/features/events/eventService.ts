import { paginationLimits } from '@shared/constants/limits';
import { applyAbortSignal } from '@shared/lib/network';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database';
import type { Event } from '@shared/types/domain';

import {
  cacheApiEvents,
  clearApiEventCache,
  getApiEvent,
  getCachedApiEvent,
  listApiEventCategories,
  loadUniversalApiBroadIndex,
  loadUniversalApiIndex,
  loadUniversalApiPreview,
  searchApiEvents,
} from './etkinlikApiService';
import type { EventCursor, EventFilters, EventPage } from './eventTypes';
import {
  applyRssFilters,
  cacheRssEvents,
  clearRssFeedCache,
  getCachedRssEvent,
  getRssEvent,
  getRssEventPreview,
  isRssEventId,
  listRssCategories,
  loadUniversalRssBroadIndex,
  loadUniversalRssIndex,
  loadUniversalRssPreview,
  searchRssEvents,
  searchRssEventsPreview,
} from './rssEventService';

type EventReadRow =
  Database['public']['Functions']['search_events']['Returns'][number];

const syncRequests = new Map<string, Promise<string>>();
const savedStateBatchSize = 100;

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function mapEvent(row: EventReadRow): Event {
  return {
    id: row.id,
    databaseId: row.id,
    externalId: row.external_id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    venue: row.venue,
    city: row.city,
    district: row.district,
    address: row.address,
    imageUrl: row.image_url,
    categories: row.categories,
    sourceUrl: row.source_url,
    attendeeCount: Number(row.attendee_count),
    attendeePhotoUrls: [],
    joined: row.joined,
    saved: row.saved,
    roomOpen: row.room_open,
  };
}

async function getDatabaseEvent(
  eventId: string,
  signal?: AbortSignal,
): Promise<Event> {
  const { data, error } = await applyAbortSignal(
    supabase.rpc('get_event_detail', {
      target_event_id: eventId,
    }),
    signal,
  );
  if (error) throw error;
  const row = data[0];
  if (!row) throw new Error('Etkinlik bulunamadı.');
  return mapEvent(row);
}

async function resolveEventDatabaseId(event: Event): Promise<string> {
  if (event.databaseId) return event.databaseId;
  if (!isRssEventId(event.id)) return event.id;
  const existing = syncRequests.get(event.id);
  if (existing) return existing;
  const request = supabase.functions
    .invoke<{ event_id?: string; error?: string }>('sync-event', {
      body: {
        source_url: event.sourceUrl,
        event: {
          title: event.title,
          summary: event.summary,
          description: event.description,
          start_at: event.startAt,
          end_at: event.endAt,
          venue: event.venue,
          city: event.city,
          district: event.district,
          address: event.address,
          image_url: event.imageUrl,
          categories: event.categories,
        },
      },
    })
    .then(async ({ data, error }) => {
      if (error) {
        const context = (error as { context?: unknown }).context;
        if (context instanceof Response) {
          let serverMessage: string | null = null;
          try {
            const payload = (await context.clone().json()) as {
              error?: unknown;
            };
            if (typeof payload.error === 'string' && payload.error.trim()) {
              serverMessage = payload.error.trim();
            }
          } catch {
            // Keep the Supabase error when the response body is not JSON.
          }
          if (serverMessage) throw new Error(serverMessage);
        }
        throw error;
      }
      if (!data?.event_id) {
        throw new Error(data?.error || 'Etkinlik hesaba bağlanamadı.');
      }
      return data.event_id;
    })
    .catch(error => {
      syncRequests.delete(event.id);
      throw error;
    });
  syncRequests.set(event.id, request);
  return request;
}

async function addSavedState(page: EventPage): Promise<EventPage> {
  const externalIds = page.items
    .map(event => event.externalId)
    .filter((id): id is number => id !== null);
  if (externalIds.length === 0) return page;
  try {
    const stateResults = await Promise.all(
      batches([...new Set(externalIds)], savedStateBatchSize).map(ids =>
        supabase.rpc('get_event_card_states', {
          target_external_ids: ids,
        }),
      ),
    );
    if (stateResults.some(result => result.error)) {
      const fallback = preserveCachedCardState(page);
      cacheApiEvents(fallback.items);
      cacheRssEvents(fallback.items);
      return fallback;
    }
    const rows = stateResults.flatMap(result => result.data ?? []);
    const photoPaths = [
      ...new Set(rows.flatMap(row => row.attendee_photo_paths)),
    ];
    const signedUrls = await getSignedProfilePhotoUrls(photoPaths);
    const states = new Map(
      rows.map(row => [
        Number(row.external_id),
        {
          ...row,
          attendeePhotoUrls: row.attendee_photo_paths.flatMap(path => {
            const url = signedUrls.get(path);
            return url ? [url] : [];
          }),
        },
      ]),
    );
    const result = {
      ...page,
      items: page.items.map(event => {
        const state =
          event.externalId === null ? null : states.get(event.externalId);
        return {
          ...event,
          databaseId: state?.database_id ?? null,
          attendeeCount: Number(state?.attendee_count ?? 0),
          attendeePhotoUrls: state?.attendeePhotoUrls ?? [],
          joined: state?.joined ?? false,
          saved: state?.saved ?? false,
        };
      }),
    };
    cacheApiEvents(result.items);
    cacheRssEvents(result.items);
    return result;
  } catch {
    const fallback = preserveCachedCardState(page);
    cacheRssEvents(fallback.items);
    return fallback;
  }
}

function preserveCachedCardState(page: EventPage): EventPage {
  return {
    ...page,
    items: page.items.map(event => {
      const cached = getCachedApiEvent(event.id) ?? getCachedRssEvent(event.id);
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
    }),
  };
}

function mergeSourceEvent(source: Event, database: Event): Event {
  return {
    ...database,
    ...source,
    databaseId: database.id,
    endAt: source.endAt ?? database.endAt,
    venue: source.venue ?? database.venue,
    city: source.city ?? database.city,
    district: source.district ?? database.district,
    address: source.address ?? database.address,
    imageUrl: source.imageUrl ?? database.imageUrl,
    attendeeCount: database.attendeeCount,
    joined: database.joined,
    saved: database.saved,
    roomOpen: database.roomOpen,
  };
}

export async function listSavedEvents(
  cursor: { savedAt: string; eventId: string } | null = null,
): Promise<{
  items: Event[];
  nextCursor: { savedAt: string; eventId: string } | null;
}> {
  const { data, error } = await supabase.rpc('list_saved_events', {
    page_size: paginationLimits.eventFeed,
    cursor_saved_at: cursor?.savedAt ?? null,
    cursor_event_id: cursor?.eventId ?? null,
  });
  if (error) throw error;
  const last = data.at(-1);
  return {
    items: data.map(mapEvent),
    nextCursor:
      data.length === 30 && last
        ? { savedAt: last.saved_at, eventId: last.id }
        : null,
  };
}

export async function searchEvents(
  filters: EventFilters,
  cursor: EventCursor | null = null,
): Promise<EventPage> {
  try {
    return addSavedState(await searchApiEvents(filters, cursor));
  } catch {
    return addSavedState(await searchRssEvents(filters, cursor));
  }
}

export async function searchEventPreview(
  filters: EventFilters,
): Promise<EventPage> {
  try {
    return addSavedState(await searchApiEvents(filters, null, 12));
  } catch {
    return addSavedState(await searchRssEventsPreview(filters));
  }
}

async function addSavedStateToEvents(events: Event[]): Promise<Event[]> {
  const page = await addSavedState({ items: events, nextCursor: null });
  return page.items;
}

export async function loadUniversalEventSearchPreview(): Promise<Event[]> {
  try {
    return addSavedStateToEvents(await loadUniversalApiPreview());
  } catch {
    return addSavedStateToEvents(await loadUniversalRssPreview());
  }
}

export async function loadUniversalEventSearchBroadIndex(): Promise<Event[]> {
  try {
    return addSavedStateToEvents(await loadUniversalApiBroadIndex());
  } catch {
    return addSavedStateToEvents(await loadUniversalRssBroadIndex());
  }
}

export async function loadUniversalEventSearchIndex(): Promise<Event[]> {
  try {
    return addSavedStateToEvents(await loadUniversalApiIndex());
  } catch {
    return addSavedStateToEvents(await loadUniversalRssIndex());
  }
}

export function filterUniversalEventSearch(
  events: Event[],
  query: string,
): Event[] {
  return applyRssFilters(events, {
    query,
    city: null,
    categories: [],
    date: 'all',
    sort: 'upcoming',
  });
}

export function clearEventFeedCache(): void {
  clearApiEventCache();
  clearRssFeedCache();
}

export async function listEventCategories(): Promise<string[]> {
  try {
    return await listApiEventCategories();
  } catch {
    return listRssCategories();
  }
}

export async function getEvent(
  eventId: string,
  signal?: AbortSignal,
): Promise<Event> {
  if (isRssEventId(eventId)) {
    let source: Event;
    try {
      source = await getApiEvent(eventId, signal);
    } catch {
      source = await getRssEventPreview(eventId);
    }
    try {
      const databaseId = await resolveEventDatabaseId(source);
      return mergeSourceEvent(
        source,
        await getDatabaseEvent(databaseId, signal),
      );
    } catch {
      try {
        return await getApiEvent(eventId, signal);
      } catch {
        return getRssEvent(eventId);
      }
    }
  }
  const database = await getDatabaseEvent(eventId, signal);
  if (database.externalId === null) return database;
  try {
    let source: Event;
    try {
      source = await getApiEvent(`etkinlik-io-${database.externalId}`, signal);
    } catch {
      source = await getRssEvent(`etkinlik-io-${database.externalId}`);
    }
    return { ...mergeSourceEvent(source, database), id: database.id };
  } catch {
    return database;
  }
}

export function getCachedEvent(eventId: string): Event | undefined {
  return isRssEventId(eventId)
    ? getCachedApiEvent(eventId) ?? getCachedRssEvent(eventId)
    : undefined;
}

export function cacheEventCardState(event: Event): void {
  if (isRssEventId(event.id)) {
    cacheApiEvents([event]);
    cacheRssEvents([event]);
  }
}

export async function setEventSaved(
  event: Event,
  saved: boolean,
): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const eventId = await resolveEventDatabaseId(event);
  if (saved) {
    const { error } = await supabase
      .from('saved_events')
      .insert({ user_id: authData.user.id, event_id: eventId });
    if (error && error.code !== '23505') throw error;
  } else {
    const { error } = await supabase
      .from('saved_events')
      .delete()
      .eq('user_id', authData.user.id)
      .eq('event_id', eventId);
    if (error) throw error;
  }
}

export async function joinEvent(event: Event | string): Promise<string> {
  const eventId =
    typeof event === 'string' ? event : await resolveEventDatabaseId(event);
  const { error } = await supabase.rpc('join_event', {
    target_event_id: eventId,
  });
  if (error) throw error;
  return eventId;
}

export async function leaveEvent(event: Event | string): Promise<string> {
  const eventId =
    typeof event === 'string' ? event : await resolveEventDatabaseId(event);
  const { error } = await supabase.rpc('leave_event', {
    target_event_id: eventId,
  });
  if (error) throw error;
  return eventId;
}

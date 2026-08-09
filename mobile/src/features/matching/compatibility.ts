import type {
  CompatibilityDimension,
  CompatibilityEvent,
  CompatibilitySnapshot,
  Interest,
  MatchContext,
} from '@shared/types/domain';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function items(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function dimension<T>(
  value: unknown,
  mapItem: (item: JsonObject) => T | null,
): CompatibilityDimension<T> {
  const source = object(value);
  return {
    score: number(source.score),
    commonCount: number(source.commonCount),
    myCount: number(source.myCount),
    theirCount: number(source.theirCount),
    items: items(source.items).flatMap(item => {
      const mapped = mapItem(item);
      return mapped ? [mapped] : [];
    }),
  };
}

function eventItem(value: JsonObject): CompatibilityEvent | null {
  const id = string(value.id);
  const title = string(value.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    startAt: string(value.startAt),
    imageUrl: optionalString(value.imageUrl),
  };
}

export function parseCompatibility(value: unknown): CompatibilitySnapshot {
  const source = object(value);
  return {
    score: number(source.score),
    calculatedAt: string(source.calculatedAt),
    interests: dimension<Pick<Interest, 'id' | 'label'>>(
      source.interests,
      item => {
        const id = string(item.id);
        const label = string(item.label);
        return id && label ? { id, label } : null;
      },
    ),
    upcoming: dimension(source.upcoming, eventItem),
    attended: dimension(source.attended, eventItem),
  };
}

export function parseMatchContext(value: unknown): MatchContext | null {
  const source = object(value);
  const matchId = string(source.matchId);
  const matchedAt = string(source.matchedAt);
  const event = eventItem(object(source.event));
  if (!matchId || !matchedAt || !event) return null;
  const firstLiker = object(source.firstLiker);
  const acceptedBy = object(source.acceptedBy);
  return {
    matchId,
    status: source.status === 'ended' ? 'ended' : 'active',
    matchedAt,
    compatibility: parseCompatibility(source.compatibility),
    firstLiker: {
      id: optionalString(firstLiker.id),
      name: optionalString(firstLiker.name),
    },
    acceptedBy: {
      id: optionalString(acceptedBy.id),
      name: optionalString(acceptedBy.name),
    },
    event,
  };
}

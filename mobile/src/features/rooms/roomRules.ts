import { addDays, subDays } from 'date-fns';

import type { RoomState } from './roomTypes';

const POST_EVENT_WINDOW_DAYS = 3;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function getRoomArchiveAt(startAt: string, endAt: string | null): Date {
  return addDays(new Date(endAt ?? startAt), POST_EVENT_WINDOW_DAYS);
}

export function getRoomState(
  startAt: string,
  endAt: string | null,
  now = new Date(),
): RoomState {
  const start = new Date(startAt);
  const end = new Date(endAt ?? startAt);
  if (now < subDays(start, 13)) return 'locked';
  if (now <= end) return 'active';
  if (now <= getRoomArchiveAt(startAt, endAt)) return 'postEvent';
  return 'archived';
}

export function formatPostEventRemaining(
  startAt: string,
  endAt: string | null,
  now = new Date(),
): string {
  const remainingMs =
    getRoomArchiveAt(startAt, endAt).getTime() - now.getTime();
  if (remainingMs <= 0) return 'Arşivlendi';
  if (remainingMs > 2 * 24 * HOUR_MS) return 'Son 3 gün';
  if (remainingMs > 24 * HOUR_MS) return 'Son 2 gün';
  if (remainingMs >= 12 * HOUR_MS) return 'Son gün';
  if (remainingMs >= HOUR_MS) {
    return `Son ${Math.ceil(remainingMs / HOUR_MS)} saat`;
  }
  if (remainingMs >= MINUTE_MS) {
    return `Son ${Math.ceil(remainingMs / MINUTE_MS)} dakika`;
  }
  return 'Son dakikalar';
}

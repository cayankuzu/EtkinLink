import { addDays, subDays } from 'date-fns';

import type { RoomState } from './roomTypes';

export function getRoomState(
  startAt: string,
  endAt: string | null,
  now = new Date(),
): RoomState {
  const start = new Date(startAt);
  const end = new Date(endAt ?? startAt);
  if (now < subDays(start, 13)) return 'locked';
  if (now <= end) return 'active';
  if (now <= addDays(end, 3)) return 'postEvent';
  return 'archived';
}

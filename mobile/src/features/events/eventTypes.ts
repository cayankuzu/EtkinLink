export type EventSort = 'upcoming' | 'newest';
export type EventDateFilter =
  | 'all'
  | 'today'
  | 'weekend'
  | `range:${string}:${string}`;

export type EventFilters = {
  query: string;
  city: string | null;
  categories: string[];
  date: EventDateFilter;
  sort: EventSort;
};

export type EventCursor = { offset: number };

export type EventPage = {
  items: import('@shared/types/domain').Event[];
  nextCursor: EventCursor | null;
};

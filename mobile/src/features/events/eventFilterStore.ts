import { addMonths, format } from 'date-fns';
import { create } from 'zustand';

import type { EventDateFilter, EventFilters } from './eventTypes';

export function createDefaultEventDateFilter(
  today = new Date(),
): EventDateFilter {
  return `range:${format(today, 'yyyy-MM-dd')}:${format(
    addMonths(today, 3),
    'yyyy-MM-dd',
  )}`;
}

function createInitialFilters(): EventFilters {
  return {
    query: '',
    city: null,
    categories: [],
    date: createDefaultEventDateFilter(),
    sort: 'upcoming',
  };
}

type EventFilterState = EventFilters & {
  defaultCity: string | null;
  initializedUserId: string | null;
  setFilters: (filters: Partial<EventFilters>) => void;
  initializeUserCity: (userId: string, city: string | null) => void;
  resetFilters: () => void;
};

export const useEventFilterStore = create<EventFilterState>((set, get) => ({
  ...createInitialFilters(),
  defaultCity: null,
  initializedUserId: null,
  setFilters: filters => set(filters),
  initializeUserCity: (userId, city) =>
    set(state => {
      if (state.initializedUserId !== userId) {
        return { initializedUserId: userId, defaultCity: city, city };
      }
      if (state.defaultCity !== city) {
        return {
          defaultCity: city,
          city: state.city === state.defaultCity ? city : state.city,
        };
      }
      return state;
    }),
  resetFilters: () =>
    set({ ...createInitialFilters(), city: get().defaultCity }),
}));

import { useEventFilterStore } from './eventFilterStore';

describe('etkinlik filtreleri', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T08:00:00+03:00'));
    useEventFilterStore.setState({
      query: '',
      city: null,
      categories: [],
      date: 'all',
      sort: 'upcoming',
      defaultCity: null,
      initializedUserId: null,
    });
  });

  afterEach(() => jest.useRealTimers());

  it('kullanıcının kayıt şehrini ilk değer ve temizleme varsayılanı yapar', () => {
    useEventFilterStore.getState().initializeUserCity('user-1', 'İstanbul');
    expect(useEventFilterStore.getState().city).toBe('İstanbul');

    useEventFilterStore.getState().setFilters({
      city: 'Ankara',
      categories: ['Konser', 'Sergi'],
      date: 'range:2026-09-12:2026-09-20',
    });
    useEventFilterStore.getState().resetFilters();

    expect(useEventFilterStore.getState()).toEqual(
      expect.objectContaining({
        city: 'İstanbul',
        categories: [],
        date: 'range:2026-08-07:2026-11-07',
        sort: 'upcoming',
      }),
    );
  });

  it('başka bir kullanıcı giriş yaptığında varsayılan şehri değiştirir', () => {
    useEventFilterStore.getState().initializeUserCity('user-1', 'İstanbul');
    useEventFilterStore.getState().setFilters({ city: 'Ankara' });
    useEventFilterStore.getState().initializeUserCity('user-2', 'İzmir');

    expect(useEventFilterStore.getState()).toEqual(
      expect.objectContaining({
        initializedUserId: 'user-2',
        defaultCity: 'İzmir',
        city: 'İzmir',
      }),
    );
  });
});

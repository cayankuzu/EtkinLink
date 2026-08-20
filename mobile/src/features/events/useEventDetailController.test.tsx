jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('../profile/profileService', () => ({
  getParticipationProfileStatus: jest.fn(),
}));

jest.mock('./eventDetailCache', () => ({
  updateEventCaches: jest.fn(),
}));

jest.mock('./eventService', () => ({
  cacheEventCardState: jest.fn(),
  getCachedEvent: jest.fn(),
  getEvent: jest.fn(),
  joinEvent: jest.fn(),
  leaveEvent: jest.fn(),
  setEventSaved: jest.fn(),
}));

import { getParticipationProfileStatus } from '@features/profile/profileService';
import type { Event } from '@shared/types/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert, Linking } from 'react-native';

import { updateEventCaches } from './eventDetailCache';
import {
  cacheEventCardState,
  getCachedEvent,
  getEvent,
  joinEvent,
  leaveEvent,
  setEventSaved,
} from './eventService';
import {
  type EventDetailNavigation,
  useEventDetailController,
} from './useEventDetailController';

const mockGetParticipationProfileStatus = jest.mocked(
  getParticipationProfileStatus,
);
const mockUpdateEventCaches = jest.mocked(updateEventCaches);
const mockCacheEventCardState = jest.mocked(cacheEventCardState);
const mockGetCachedEvent = jest.mocked(getCachedEvent);
const mockGetEvent = jest.mocked(getEvent);
const mockJoinEvent = jest.mocked(joinEvent);
const mockLeaveEvent = jest.mocked(leaveEvent);
const mockSetEventSaved = jest.mocked(setEventSaved);

const day = 24 * 60 * 60 * 1000;
const event: Event = {
  id: 'external-1',
  databaseId: 'event-1',
  externalId: 12,
  title: 'Yaz Konseri',
  summary: 'Kısa özet',
  description: 'A'.repeat(220),
  startAt: new Date(Date.now() + day).toISOString(),
  endAt: null,
  venue: 'Arena',
  city: 'İstanbul',
  district: 'Kadıköy',
  address: null,
  imageUrl: 'https://example.com/event.jpg',
  categories: ['Müzik', 'müzik', 'Konser'],
  sourceUrl: 'https://example.com/event',
  attendeeCount: 10,
  joined: false,
  saved: false,
};

function createHarness(eventValue: Event = event) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { gcTime: Infinity, retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  const navigate = jest.fn();
  const navigation: EventDetailNavigation = {
    goBack: jest.fn(),
    getParent: function getParent<TNavigation>() {
      return { navigate } as unknown as TNavigation;
    },
  };
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  mockGetEvent.mockResolvedValue(eventValue);
  mockGetParticipationProfileStatus.mockResolvedValue({
    ready: false,
    missingSteps: [
      { id: 'photos', label: 'Fotoğraf ekle', destination: 'EditPhotos' },
    ],
  });
  return { navigate, navigation, queryClient, wrapper };
}

describe('useEventDetailController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCachedEvent.mockReturnValue(undefined);
  });

  it('etkinlik ve profil durumunu yükleyip görünüm modelini normalize eder', async () => {
    const harness = createHarness();

    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));

    expect(result.current.displayCategories).toEqual(['Müzik', 'Konser']);
    expect(result.current.description).toBe(event.description);
    expect(result.current.descriptionCanExpand).toBe(true);
    expect(result.current.location).toBe('Arena · Kadıköy · İstanbul');
    expect(result.current.missingProfileSteps).toEqual([
      { id: 'photos', label: 'Fotoğraf ekle', destination: 'EditPhotos' },
    ]);
  });

  it('katılma başarısında sayaç ve oda durumunu cache katmanlarına tutarlı yazar', async () => {
    const harness = createHarness();
    const invalidate = jest.spyOn(harness.queryClient, 'invalidateQueries');
    mockJoinEvent.mockResolvedValue('event-1');
    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.attendance.mutateAsync({ event, join: true });
    });

    expect(mockJoinEvent).toHaveBeenCalledWith(event);
    expect(mockUpdateEventCaches).toHaveBeenCalledWith(
      harness.queryClient,
      'external-1',
      event,
      expect.objectContaining({
        databaseId: 'event-1',
        joined: true,
        attendeeCount: 11,
        roomOpen: true,
      }),
    );
    expect(mockCacheEventCardState).toHaveBeenCalledWith(
      expect.objectContaining({ joined: true, attendeeCount: 11 }),
    );
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(result.current.actionError).toBeNull();
    expect(result.current.joinConfirmOpen).toBe(false);
  });

  it('ayrılmayı kullanıcıya onaylatır ve negatif sayaç üretmez', async () => {
    const joinedEvent = { ...event, attendeeCount: 0, joined: true };
    const harness = createHarness(joinedEvent);
    mockLeaveEvent.mockResolvedValue('event-1');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation();
    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));

    await act(() => result.current.confirmLeave());
    const buttons = alert.mock.calls[0]?.[2] as
      | { onPress?: () => void }[]
      | undefined;
    await act(() => buttons?.[1]?.onPress?.());
    await waitFor(() => expect(mockLeaveEvent).toHaveBeenCalled());

    expect(mockUpdateEventCaches).toHaveBeenCalledWith(
      harness.queryClient,
      'external-1',
      joinedEvent,
      expect.objectContaining({ joined: false, attendeeCount: 0 }),
    );
    alert.mockRestore();
  });

  it('kaydetme değişikliğini detay, liste ve kalıcı kart cachelerine yayar', async () => {
    const harness = createHarness();
    mockSetEventSaved.mockResolvedValue();
    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));
    await act(async () => {
      await result.current.save.mutateAsync({ event, saved: true });
    });

    expect(mockSetEventSaved).toHaveBeenCalledWith(event, true);
    expect(mockUpdateEventCaches).toHaveBeenCalledWith(
      harness.queryClient,
      'external-1',
      event,
      { saved: true },
    );
    expect(mockCacheEventCardState).toHaveBeenCalledWith(
      expect.objectContaining({ saved: true }),
    );
  });

  it('oda, eşleşme ve profil hedeflerini doğru tab parametreleriyle açar', async () => {
    const harness = createHarness();
    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));

    await act(() => result.current.openRoom());
    await act(() => result.current.openMatching());
    await act(() => result.current.openProfileCompletion('EditPhotos'));

    expect(harness.navigate.mock.calls).toEqual([
      ['RoomsTab', { screen: 'RoomDetail', params: { eventId: 'event-1' } }],
      ['RoomsTab', { screen: 'MatchHub', params: { eventId: 'event-1' } }],
      ['ProfileTab', { screen: 'EditPhotos' }],
    ]);
  });

  it('mutation ve harici URL hatalarını kullanıcıya açık duruma çevirir', async () => {
    const harness = createHarness();
    mockJoinEvent.mockRejectedValue(new Error('Katılım reddedildi'));
    const openUrl = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('Bağlantı açılamadı'));
    const { result } = await renderHook(
      () => useEventDetailController('external-1', harness.navigation),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(result.current.eventQuery.isSuccess).toBe(true));

    let mutationError: unknown;
    await act(async () => {
      try {
        await result.current.attendance.mutateAsync({ event, join: true });
      } catch (error) {
        mutationError = error;
      }
    });
    expect(mutationError).toEqual(new Error('Katılım reddedildi'));
    await waitFor(() =>
      expect(result.current.actionError).toBe('Katılım reddedildi'),
    );
    expect(mockGetParticipationProfileStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await result.current.openUrl(event.sourceUrl);
    });
    expect(openUrl).toHaveBeenCalledWith(event.sourceUrl);
    expect(result.current.actionError).toBe('Bağlantı açılamadı');
    openUrl.mockRestore();
  });
});

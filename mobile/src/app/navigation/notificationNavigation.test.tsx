import { queryClient } from '@shared/lib/queryClient';
import { act, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import {
  navigationRef,
  useNotificationNavigation,
} from './notificationNavigation';

const UUID_A = '11111111-1111-4111-8111-111111111111';

type ResponseHandler = (response: Notifications.NotificationResponse) => void;
type ReceivedHandler = (notification: Notifications.Notification) => void;

function response(
  identifier: string,
  data: Record<string, unknown> | undefined,
): Notifications.NotificationResponse {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: {
      date: Date.now(),
      request: {
        identifier,
        trigger: null,
        content: {
          title: null,
          subtitle: null,
          body: null,
          data,
          sound: null,
          badge: null,
        },
      },
    },
  } as Notifications.NotificationResponse;
}

describe('bildirim yönlendirmesi', () => {
  let responseHandler: ResponseHandler;
  let receivedHandler: ReceivedHandler;
  const responseSubscription = { remove: jest.fn() };
  const receivedSubscription = { remove: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(Notifications.addNotificationResponseReceivedListener)
      .mockImplementation(handler => {
        responseHandler = handler;
        return responseSubscription;
      });
    jest
      .mocked(Notifications.addNotificationReceivedListener)
      .mockImplementation(handler => {
        receivedHandler = handler;
        return receivedSubscription;
      });
    jest
      .mocked(Notifications.getLastNotificationResponse)
      .mockReturnValue(null);
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true);
    jest.spyOn(navigationRef, 'navigate').mockImplementation(jest.fn());
    jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('desteklenen bildirimleri doğru ekrana yönlendirir ve tekrarı yutar', async () => {
    const { unmount } = await renderHook(() => useNotificationNavigation(true));

    await act(() => {
      responseHandler(
        response('match-1', { routeKind: 'match', routeId: UUID_A }),
      );
      responseHandler(
        response('room-1', { routeKind: 'room', routeId: UUID_A }),
      );
      responseHandler(
        response('likes-1', { routeKind: 'likes', routeId: 'bozuk' }),
      );
      responseHandler(
        response('event-1', { routeKind: 'event', routeId: UUID_A }),
      );
      responseHandler(
        response('event-1', { routeKind: 'event', routeId: UUID_A }),
      );
      responseHandler(response('invalid-kind', { routeKind: 'unknown' }));
      responseHandler(
        response('invalid-id', { routeKind: 'match', routeId: 'bozuk' }),
      );
      responseHandler(response('empty-data', undefined));
    });

    expect(navigationRef.navigate).toHaveBeenCalledTimes(4);
    expect(navigationRef.navigate).toHaveBeenCalledWith('MessagesTab', {
      screen: 'DirectChat',
      params: { matchId: UUID_A },
    });
    expect(navigationRef.navigate).toHaveBeenCalledWith('RoomsTab', {
      screen: 'RoomDetail',
      params: { eventId: UUID_A },
    });
    expect(navigationRef.navigate).toHaveBeenCalledWith('MatchesTab', {
      screen: 'Matches',
      params: { section: 'incoming' },
    });
    expect(navigationRef.navigate).toHaveBeenCalledWith('DiscoverTab', {
      screen: 'EventDetail',
      params: { eventId: UUID_A },
    });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(
      4,
    );

    await unmount();
    expect(responseSubscription.remove).toHaveBeenCalled();
    expect(receivedSubscription.remove).toHaveBeenCalled();
  });

  it('oturum açılana ve navigasyon hazır olana kadar rotayı bekletir', async () => {
    const ready = jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
    const { rerender } = await renderHook(
      ({ signedIn }: { signedIn: boolean }) =>
        useNotificationNavigation(signedIn),
      { initialProps: { signedIn: false } },
    );

    await act(() => {
      responseHandler(
        response('pending', { routeKind: 'room', routeId: UUID_A }),
      );
    });
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    ready.mockReturnValue(true);
    await rerender({ signedIn: true });

    expect(navigationRef.navigate).toHaveBeenCalledWith('RoomsTab', {
      screen: 'RoomDetail',
      params: { eventId: UUID_A },
    });
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalledTimes(
      1,
    );
  });

  it('alınan ve son yanıt verilerini ilgili sorgularla yeniler', async () => {
    jest.mocked(Notifications.getLastNotificationResponse).mockReturnValueOnce(
      response('last', {
        routeKind: 'likes',
        routeId: UUID_A,
        kind: 'new_like',
      }),
    );
    await renderHook(() => useNotificationNavigation(true));

    await act(() => {
      receivedHandler(
        response('direct', { kind: 'direct_message' }).notification,
      );
      receivedHandler(response('room', { kind: 'room_message' }).notification);
      receivedHandler(response('match', { kind: 'new_match' }).notification);
      receivedHandler(response('ended', { kind: 'match_ended' }).notification);
      receivedHandler(response('blocked', { kind: 'blocked' }).notification);
      receivedHandler(
        response('unblocked', { kind: 'unblocked' }).notification,
      );
      receivedHandler(response('irrelevant', { kind: 'other' }).notification);
      receivedHandler(response('no-data', undefined).notification);
    });

    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    expect(navigationRef.navigate).toHaveBeenCalledWith('MatchesTab', {
      screen: 'Matches',
      params: { section: 'incoming' },
    });
  });

  it('navigasyon hazır değilse oturum açıkken de yönlendirme yapmaz', async () => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(false);
    await renderHook(() => useNotificationNavigation(true));

    await act(() => {
      responseHandler(
        response('not-ready', { routeKind: 'event', routeId: UUID_A }),
      );
    });

    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});

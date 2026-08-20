import type {
  AuthStackParamList,
  MainTabParamList,
} from '@app/navigation/types';
import { createNavigationContainerRef } from '@react-navigation/native';
import { queryClient } from '@shared/lib/queryClient';
import { queryKeys } from '@shared/lib/queryKeys';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef } from 'react';

type RootNavigationParamList = MainTabParamList & AuthStackParamList;

export const navigationRef =
  createNavigationContainerRef<RootNavigationParamList>();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NotificationRoute =
  | { kind: 'match'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'likes'; id: string | null }
  | { kind: 'event'; id: string };

function parseRoute(data: Record<string, unknown>): NotificationRoute | null {
  const routeKind = data.routeKind;
  const routeId = data.routeId;
  if (
    routeKind !== 'match' &&
    routeKind !== 'room' &&
    routeKind !== 'likes' &&
    routeKind !== 'event'
  ) {
    return null;
  }
  if (routeKind === 'likes') {
    return {
      kind: routeKind,
      id:
        typeof routeId === 'string' && UUID_PATTERN.test(routeId)
          ? routeId
          : null,
    };
  }
  if (typeof routeId !== 'string' || !UUID_PATTERN.test(routeId)) return null;
  return { kind: routeKind, id: routeId };
}

function refreshNotificationData(data: Record<string, unknown>): void {
  const kind = data.kind;
  if (kind === 'direct_message') {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messages.matches,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messages.direct(),
    });
  } else if (kind === 'room_message') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.rooms.messages(),
    });
  } else if (kind === 'new_like') {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.matching.likeCounts,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.matching.incomingLiked,
    });
  } else if (
    kind === 'new_match' ||
    kind === 'match_ended' ||
    kind === 'blocked' ||
    kind === 'unblocked'
  ) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messages.matches,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.matching.likeCounts,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messages.direct(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.profile.blockedUsers,
    });
  }
}

function navigateToNotification(route: NotificationRoute): void {
  if (!navigationRef.isReady()) return;
  switch (route.kind) {
    case 'match':
      navigationRef.navigate('MessagesTab', {
        screen: 'DirectChat',
        params: { matchId: route.id },
      });
      break;
    case 'room':
      navigationRef.navigate('RoomsTab', {
        screen: 'RoomDetail',
        params: { eventId: route.id },
      });
      break;
    case 'likes':
      navigationRef.navigate('MatchesTab', {
        screen: 'Matches',
        params: { section: 'incoming' },
      });
      break;
    case 'event':
      navigationRef.navigate('DiscoverTab', {
        screen: 'EventDetail',
        params: { eventId: route.id },
      });
      break;
  }
}

export function useNotificationNavigation(signedIn: boolean): void {
  const pendingRoute = useRef<NotificationRoute | null>(null);
  const handledIdentifiers = useRef(new Set<string>());

  const handleResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (handledIdentifiers.current.has(identifier)) return;
      handledIdentifiers.current.add(identifier);

      const data = response.notification.request.content.data ?? {};
      refreshNotificationData(data);
      const route = parseRoute(data);
      if (!route) return;
      if (!signedIn || !navigationRef.isReady()) {
        pendingRoute.current = route;
        return;
      }
      navigateToNotification(route);
      Notifications.clearLastNotificationResponse();
    },
    [signedIn],
  );

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(
      notification =>
        refreshNotificationData(notification.request.content.data ?? {}),
    );
    const response =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) handleResponse(lastResponse);
    return () => {
      received.remove();
      response.remove();
    };
  }, [handleResponse]);

  useEffect(() => {
    if (!signedIn || !pendingRoute.current || !navigationRef.isReady()) return;
    const route = pendingRoute.current;
    pendingRoute.current = null;
    navigateToNotification(route);
    Notifications.clearLastNotificationResponse();
  }, [signedIn]);
}

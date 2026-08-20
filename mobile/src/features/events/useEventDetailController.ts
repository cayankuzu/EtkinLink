import type { MainTabParamList } from '@app/navigation/types';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import type { Event } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking } from 'react-native';

import {
  getParticipationProfileStatus,
  type ParticipationProfileDestination,
} from '../profile/profileService';
import { updateEventCaches } from './eventDetailCache';
import {
  cacheEventCardState,
  getCachedEvent,
  getEvent,
  joinEvent,
  leaveEvent,
  setEventSaved,
} from './eventService';

export type EventDetailNavigation = {
  goBack: () => void;
  getParent: <TNavigation>() => TNavigation | undefined;
};

export function useEventDetailController(
  eventId: string,
  navigation: EventDetailNavigation,
) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const queryClient = useQueryClient();
  const eventQuery = useQuery({
    queryKey: queryKeys.events.detail(eventId),
    queryFn: ({ signal }) => getEvent(eventId, signal),
    placeholderData: getCachedEvent(eventId),
    staleTime: 60 * 1000,
  });
  const profileStatusQuery = useQuery({
    queryKey: queryKeys.profile.participationStatus,
    queryFn: getParticipationProfileStatus,
  });

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.participationStatus,
      });
    }, [queryClient]),
  );

  const attendance = useMutation({
    mutationFn: async ({ event, join }: { event: Event; join: boolean }) =>
      join ? joinEvent(event) : leaveEvent(event),
    onSuccess: (databaseId, variables) => {
      const attendeeDelta = variables.join
        ? variables.event.joined
          ? 0
          : 1
        : variables.event.joined
        ? -1
        : 0;
      const update: Partial<Event> = {
        databaseId,
        joined: variables.join,
        attendeeCount: Math.max(
          0,
          variables.event.attendeeCount + attendeeDelta,
        ),
        roomOpen: variables.event.roomOpen ?? roomIsOpen(variables.event),
      };
      updateEventCaches(queryClient, eventId, variables.event, update);
      cacheEventCardState({ ...variables.event, ...update });
      setJoinConfirmOpen(false);
      setActionError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events.detail(eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events.all,
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
    onError: error => {
      setActionError(toAppError(error).message);
      void profileStatusQuery.refetch();
    },
  });

  const save = useMutation({
    mutationFn: ({ event, saved }: { event: Event; saved: boolean }) =>
      setEventSaved(event, saved),
    onSuccess: (_, variables) => {
      const update = { saved: variables.saved };
      updateEventCaches(queryClient, eventId, variables.event, update);
      cacheEventCardState({ ...variables.event, ...update });
      setActionError(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events.detail(eventId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events.all,
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.saved });
    },
    onError: error => setActionError(toAppError(error).message),
  });

  const event = eventQuery.data;
  const displayCategories = useMemo(
    () =>
      event?.categories.filter(
        (category, index, values) =>
          values.findIndex(
            value =>
              value.trim().localeCompare(category.trim(), 'tr-TR', {
                sensitivity: 'base',
              }) === 0,
          ) === index,
      ) ?? [],
    [event],
  );
  const description =
    event?.description ||
    event?.summary ||
    'Açıklama için etkinliğin kaynak sayfasını ziyaret edebilirsin.';
  const location = event
    ? [event.venue, event.district, event.city].filter(Boolean).join(' · ') ||
      'Konum bilgisi kaynak sayfada'
    : '';
  const missingProfileSteps = profileStatusQuery.data?.missingSteps ?? [];

  const confirmLeave = useCallback(() => {
    if (!event) return;
    Alert.alert(
      'Etkinlikten ayrıl',
      'Odaya ve bu etkinliğe özel eşleşme alanına erişimin kapanır. Devam edilsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Etkinlikten ayrıl',
          style: 'destructive',
          onPress: () => attendance.mutate({ event, join: false }),
        },
      ],
    );
  }, [attendance, event]);

  const openTab = useCallback(
    (tab: 'room' | 'matching') => {
      if (!event?.databaseId) return;
      const parent =
        navigation.getParent<BottomTabNavigationProp<MainTabParamList>>();
      if (tab === 'room') {
        parent?.navigate('RoomsTab', {
          screen: 'RoomDetail',
          params: { eventId: event.databaseId },
        });
      } else {
        parent?.navigate('RoomsTab', {
          screen: 'MatchHub',
          params: { eventId: event.databaseId },
        });
      }
    },
    [event?.databaseId, navigation],
  );

  const openProfileCompletion = useCallback(
    (destination: ParticipationProfileDestination) => {
      navigation
        .getParent<BottomTabNavigationProp<MainTabParamList>>()
        ?.navigate('ProfileTab', { screen: destination });
    },
    [navigation],
  );

  const openUrl = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      setActionError(toAppError(error).message);
    }
  }, []);

  return {
    actionError,
    attendance,
    confirmLeave,
    description,
    descriptionCanExpand: description.length > 180,
    descriptionExpanded,
    displayCategories,
    eventQuery,
    imageViewerOpen,
    joinConfirmOpen,
    location,
    missingProfileSteps,
    openMatching: () => openTab('matching'),
    openProfileCompletion,
    openRoom: () => openTab('room'),
    openUrl,
    profileStatusQuery,
    save,
    setDescriptionExpanded,
    setImageViewerOpen,
    setJoinConfirmOpen,
  };
}

function roomIsOpen(event: Event): boolean {
  const start = new Date(event.startAt).getTime();
  if (Number.isNaN(start)) return false;
  const endValue = event.endAt ? new Date(event.endAt).getTime() : start;
  const end = Number.isNaN(endValue) ? start : endValue;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return now >= start - 13 * day && now <= end + 3 * day;
}

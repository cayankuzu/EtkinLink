import type {
  DiscoverStackParamList,
  MainTabParamList,
} from '@app/navigation/types';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
} from '@shared/components';
import { formatEventDate } from '@shared/lib/date';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type { Event, EventSourceDetails } from '@shared/types/domain';
import {
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  Bookmark,
  Building2,
  CalendarDays,
  Clock3,
  ExternalLink,
  Info as InfoIcon,
  MapPin,
  Ticket,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getParticipationProfileStatus,
  type ParticipationProfileDestination,
} from '../profile/profileService';
import { compatibleEventImageUrl, EventImage } from './EventImage';
import {
  cacheEventCardState,
  getCachedEvent,
  getEvent,
  joinEvent,
  leaveEvent,
  setEventSaved,
} from './eventService';
import type { EventPage } from './eventTypes';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'EventDetail'>;

function isSameEvent(candidate: Event, target: Event): boolean {
  return (
    candidate.id === target.id ||
    (candidate.externalId !== null &&
      candidate.externalId === target.externalId) ||
    (candidate.databaseId != null && candidate.databaseId === target.databaseId)
  );
}

function updateFeedPage(
  page: EventPage,
  target: Event,
  update: Partial<Event>,
): EventPage {
  return {
    ...page,
    items: page.items.map(item =>
      isSameEvent(item, target) ? { ...item, ...update } : item,
    ),
  };
}

function updateEventList(
  items: Event[],
  target: Event,
  update: Partial<Event>,
): Event[] {
  return items.map(item =>
    isSameEvent(item, target) ? { ...item, ...update } : item,
  );
}

export function EventDetailScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [actionError, setActionError] = useState<string | null>(null);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const queryClient = useQueryClient();
  const eventQuery = useQuery({
    queryKey: ['event', route.params.eventId],
    queryFn: () => getEvent(route.params.eventId),
    placeholderData: () => getCachedEvent(route.params.eventId),
    staleTime: 60 * 1000,
  });
  const profileStatusQuery = useQuery({
    queryKey: ['profile', 'participation-status'],
    queryFn: getParticipationProfileStatus,
  });
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({
        queryKey: ['profile', 'participation-status'],
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
      queryClient.setQueryData<Event>(
        ['event', route.params.eventId],
        current => {
          if (!current) return current;
          return { ...current, ...update };
        },
      );
      queryClient.setQueriesData<InfiniteData<EventPage>>(
        { queryKey: ['events'] },
        current =>
          current
            ? {
                ...current,
                pages: current.pages.map(page =>
                  updateFeedPage(page, variables.event, update),
                ),
              }
            : current,
      );
      queryClient.setQueriesData<EventPage>(
        { queryKey: ['events-preview'] },
        current =>
          current ? updateFeedPage(current, variables.event, update) : current,
      );
      queryClient.setQueriesData<Event[]>(
        { queryKey: ['events-snapshot'] },
        current =>
          current ? updateEventList(current, variables.event, update) : current,
      );
      queryClient.setQueriesData<Event[]>(
        { queryKey: ['event-search-index'] },
        current =>
          current ? updateEventList(current, variables.event, update) : current,
      );
      queryClient.setQueriesData<
        InfiniteData<{ items: Event[]; nextCursor: unknown }>
      >({ queryKey: ['saved-events'] }, current =>
        current
          ? {
              ...current,
              pages: current.pages.map(page => ({
                ...page,
                items: updateEventList(page.items, variables.event, update),
              })),
            }
          : current,
      );
      cacheEventCardState({ ...variables.event, ...update });
      setJoinConfirmOpen(false);
      setActionError(null);
      void queryClient.invalidateQueries({
        queryKey: ['event', route.params.eventId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['events'],
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({ queryKey: ['rooms'] });
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
      queryClient.setQueryData<Event>(
        ['event', route.params.eventId],
        current => (current ? { ...current, ...update } : current),
      );
      queryClient.setQueriesData<InfiniteData<EventPage>>(
        { queryKey: ['events'] },
        current =>
          current
            ? {
                ...current,
                pages: current.pages.map(page =>
                  updateFeedPage(page, variables.event, update),
                ),
              }
            : current,
      );
      queryClient.setQueriesData<EventPage>(
        { queryKey: ['events-preview'] },
        current =>
          current ? updateFeedPage(current, variables.event, update) : current,
      );
      queryClient.setQueriesData<Event[]>(
        { queryKey: ['event-search-index'] },
        current =>
          current ? updateEventList(current, variables.event, update) : current,
      );
      cacheEventCardState({ ...variables.event, ...update });
      setActionError(null);
      void queryClient.invalidateQueries({
        queryKey: ['event', route.params.eventId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['events'],
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({ queryKey: ['saved-events'] });
    },
    onError: error => setActionError(toAppError(error).message),
  });

  if (eventQuery.isLoading) {
    return (
      <Screen scroll contentStyle={styles.loadingScreen}>
        <Skeleton style={styles.heroSkeleton} />
        <Skeleton style={styles.titleSkeleton} />
        <Skeleton style={styles.bodySkeleton} />
      </Screen>
    );
  }

  if (eventQuery.isError || !eventQuery.data) {
    return (
      <Screen contentStyle={styles.errorScreen}>
        <View style={styles.errorHeader}>
          <IconButton
            icon={ArrowLeft}
            label="Geri"
            onPress={navigation.goBack}
          />
        </View>
        <ErrorState
          title="Etkinlik açılamadı"
          description={toAppError(eventQuery.error).message}
          actionLabel="Tekrar dene"
          onAction={() => void eventQuery.refetch()}
        />
      </Screen>
    );
  }

  const event = eventQuery.data;
  const displayCategories = event.categories.filter(
    (category, index, values) =>
      values.findIndex(
        value =>
          value.trim().localeCompare(category.trim(), 'tr-TR', {
            sensitivity: 'base',
          }) === 0,
      ) === index,
  );
  const databaseEventId = event.databaseId ?? null;
  const description =
    event.description ||
    event.summary ||
    'Açıklama için etkinliğin kaynak sayfasını ziyaret edebilirsin.';
  const descriptionCanExpand = description.length > 180;
  const location =
    [event.venue, event.district, event.city].filter(Boolean).join(' · ') ||
    'Konum bilgisi kaynak sayfada';
  const missingProfileSteps = profileStatusQuery.data?.missingSteps ?? [];

  function confirmLeave() {
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
  }

  function openRoom() {
    if (!databaseEventId) return;
    navigation
      .getParent<BottomTabNavigationProp<MainTabParamList>>()
      ?.navigate('RoomsTab', {
        screen: 'RoomDetail',
        params: { eventId: databaseEventId },
      });
  }

  function openMatching() {
    if (!databaseEventId) return;
    navigation
      .getParent<BottomTabNavigationProp<MainTabParamList>>()
      ?.navigate('RoomsTab', {
        screen: 'MatchHub',
        params: { eventId: databaseEventId },
      });
  }

  function openProfileCompletion(destination: ParticipationProfileDestination) {
    navigation
      .getParent<BottomTabNavigationProp<MainTabParamList>>()
      ?.navigate('ProfileTab', { screen: destination });
  }

  async function openUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch (error) {
      setActionError(toAppError(error).message);
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar
        translucent
        barStyle="light-content"
        backgroundColor="transparent"
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 104 + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={eventQuery.isRefetching}
            onRefresh={() => void eventQuery.refetch()}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        <View style={styles.heroWrap}>
          <Pressable
            accessibilityRole={event.imageUrl ? 'button' : undefined}
            accessibilityLabel={
              event.imageUrl ? 'Etkinlik fotoğrafını büyüt' : undefined
            }
            disabled={!event.imageUrl}
            onPress={() => setImageViewerOpen(true)}
            style={styles.heroPressable}
          >
            <EventImage
              imageUrl={event.imageUrl}
              style={styles.hero}
              placeholderStyle={styles.heroFallback}
              iconSize={52}
            />
          </Pressable>
          <View pointerEvents="none" style={styles.heroShade} />
          <IconButton
            icon={ArrowLeft}
            label="Geri"
            onPress={navigation.goBack}
            style={{
              ...styles.overlayButton,
              top: insets.top + spacing.sm,
            }}
          />
        </View>

        <View style={styles.contentSheet}>
          <View style={styles.topMeta}>
            <View style={styles.categoryBadge}>
              <AppText variant="tiny11" tone="brand" numberOfLines={1}>
                {event.categories[0] ?? 'Etkinlik'}
              </AppText>
            </View>
            <AppText variant="caption12" tone="tertiary">
              {formatEventDate(event.startAt)}
            </AppText>
          </View>

          <AppText variant="heading24">{event.title}</AppText>

          <AppButton
            label={event.saved ? 'Kaydedildi' : 'Etkinliği kaydet'}
            icon={Bookmark}
            variant="secondary"
            loading={save.isPending}
            onPress={() => save.mutate({ event, saved: !event.saved })}
          />

          <View style={styles.infoCard}>
            <InfoRow
              icon={CalendarDays}
              label="Başlangıç"
              value={formatEventDate(event.startAt)}
            />
            {event.endAt ? (
              <>
                <View style={styles.infoDivider} />
                <InfoRow
                  icon={Clock3}
                  label="Bitiş"
                  value={formatEventDate(event.endAt)}
                />
              </>
            ) : null}
            <View style={styles.infoDivider} />
            <InfoRow icon={Building2} label="Mekân" value={location} />
            {event.address ? (
              <>
                <View style={styles.infoDivider} />
                <InfoRow icon={MapPin} label="Adres" value={event.address} />
              </>
            ) : null}
          </View>

          {displayCategories.length ? (
            <View style={styles.categoryList}>
              {displayCategories.map(category => (
                <View
                  key={category.toLocaleLowerCase('tr-TR')}
                  style={styles.secondaryCategory}
                >
                  <AppText variant="tiny11" tone="secondary">
                    {category}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <AppText variant="heading18">Etkinlik hakkında</AppText>
            <AppText
              variant="body15"
              tone="secondary"
              selectable
              numberOfLines={descriptionExpanded ? undefined : 4}
            >
              {description}
            </AppText>
            {descriptionCanExpand ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  descriptionExpanded
                    ? 'Açıklamayı daralt'
                    : 'Açıklamanın devamını göster'
                }
                onPress={() => setDescriptionExpanded(current => !current)}
                style={({ pressed }) => [
                  styles.descriptionToggle,
                  pressed && styles.pressed,
                ]}
              >
                <AppText variant="label14" tone="brand">
                  {descriptionExpanded ? 'Daralt' : 'Devamını göster'}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {event.sourceDetails ? (
            <SourceDetails details={event.sourceDetails} />
          ) : null}

          <View style={styles.section}>
            <AppText variant="heading18">Etkinlik bilgileri</AppText>
            <View style={styles.infoCard}>
              <InfoRow
                icon={Ticket}
                label="Etkinlik numarası"
                value={event.externalId ? String(event.externalId) : event.id}
              />
              <View style={styles.infoDivider} />
              <InfoRow
                icon={UsersRound}
                label="EtkinLink katılımcıları"
                value={`${event.attendeeCount} kişi`}
              />
              <View style={styles.infoDivider} />
              <InfoRow
                icon={InfoIcon}
                label="Oda durumu"
                value={event.roomOpen ? 'Açık' : 'Henüz açılmadı'}
              />
            </View>
          </View>

          <View style={styles.notice}>
            <InfoIcon size={20} color={colors.brand} />
            <AppText variant="caption12" tone="brand" style={styles.noticeText}>
              Oda, etkinlikten 13 gün önce açılır. Katıldığında diğer
              katılımcılarla sohbet edebilir ve eşleşebilirsin.
            </AppText>
          </View>

          <View style={styles.sourceNotice}>
            <ExternalLink size={18} color={colors.textSecondary} />
            <AppText
              variant="caption12"
              tone="secondary"
              style={styles.noticeText}
            >
              Bilgiler Etkinlik.io kaynağından alınır. Son değişiklikler için
              kaynak sayfayı kontrol edebilirsin.
            </AppText>
          </View>

          {event.sourceDetails?.ticketUrl ? (
            <AppButton
              label="Bilet sayfasını aç"
              variant="secondary"
              icon={Ticket}
              onPress={() =>
                void openUrl(event.sourceDetails?.ticketUrl ?? event.sourceUrl)
              }
            />
          ) : null}
          <AppButton
            label="Etkinlik.io’da görüntüle"
            variant="secondary"
            icon={ExternalLink}
            onPress={() => void openUrl(event.sourceUrl)}
          />

          {!event.joined && profileStatusQuery.isError ? (
            <View style={styles.profileGate}>
              <View style={styles.profileGateHeader}>
                <InfoIcon size={20} color={colors.danger} />
                <View style={styles.profileGateCopy}>
                  <AppText variant="label14">Profil kontrol edilemedi</AppText>
                  <AppText variant="caption12" tone="secondary">
                    Katılım koşullarını gösterebilmek için profilini yeniden
                    kontrol etmeliyiz.
                  </AppText>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profil durumunu yeniden kontrol et"
                onPress={() => void profileStatusQuery.refetch()}
                style={({ pressed }) => [
                  styles.profileGateLink,
                  pressed && styles.pressed,
                ]}
              >
                <AppText variant="label14" tone="brand">
                  Tekrar kontrol et
                </AppText>
              </Pressable>
            </View>
          ) : !event.joined && missingProfileSteps.length > 0 ? (
            <View style={styles.profileGate}>
              <View style={styles.profileGateHeader}>
                <InfoIcon size={20} color={colors.brand} />
                <View style={styles.profileGateCopy}>
                  <AppText variant="label14">
                    Katılım için profilini tamamla
                  </AppText>
                  <AppText variant="caption12" tone="secondary">
                    Etkinliğe katılabilmen için aşağıdaki adımlar eksik:
                  </AppText>
                </View>
              </View>
              <View style={styles.profileStepList}>
                {missingProfileSteps.map(step => (
                  <Pressable
                    key={step.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${step.label}. Düzenlemeye git`}
                    onPress={() => openProfileCompletion(step.destination)}
                    style={({ pressed }) => [
                      styles.profileStep,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.profileStepBullet} />
                    <AppText variant="body14" style={styles.profileStepLabel}>
                      {step.label}
                    </AppText>
                    <AppText variant="caption12" tone="brand">
                      Düzenle
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {event.joined ? (
            <AppButton
              label="Etkinlikten ayrıl"
              variant="ghost"
              onPress={confirmLeave}
            />
          ) : null}
          {actionError ? (
            <AppText
              variant="caption12"
              tone="danger"
              accessibilityRole="alert"
            >
              {actionError}
            </AppText>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.fixedAction,
          { paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
      >
        {event.joined && event.roomOpen ? (
          <View style={styles.joinedActions}>
            <AppButton
              label="Odaya git"
              fullWidth={false}
              style={styles.joinedAction}
              onPress={openRoom}
            />
            <AppButton
              label="Eşleşmeye git"
              fullWidth={false}
              variant="secondary"
              style={styles.joinedAction}
              onPress={openMatching}
            />
          </View>
        ) : event.joined ? (
          <View style={styles.joinedActions}>
            <AppButton
              label="Etkinlik odası yakında"
              fullWidth={false}
              style={styles.joinedAction}
              disabled
            />
            <AppButton
              label="Etkinlikten ayrıl"
              fullWidth={false}
              variant="secondary"
              style={styles.joinedAction}
              loading={attendance.isPending}
              onPress={confirmLeave}
            />
          </View>
        ) : profileStatusQuery.isLoading ? (
          <AppButton label="Profil kontrol ediliyor…" disabled />
        ) : profileStatusQuery.isError ? (
          <AppButton
            label="Profil durumunu tekrar kontrol et"
            variant="secondary"
            loading={profileStatusQuery.isFetching}
            onPress={() => void profileStatusQuery.refetch()}
          />
        ) : missingProfileSteps.length > 0 ? (
          <AppButton
            label="Eksik profil adımlarını tamamla"
            onPress={() => {
              const firstStep = missingProfileSteps[0];
              if (firstStep) openProfileCompletion(firstStep.destination);
            }}
          />
        ) : (
          <AppButton
            label="Etkinliğe katıl"
            loading={attendance.isPending}
            onPress={() => setJoinConfirmOpen(true)}
          />
        )}
      </View>

      <Modal
        visible={imageViewerOpen && Boolean(event.imageUrl)}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setImageViewerOpen(false)}
      >
        <StatusBar barStyle="light-content" backgroundColor="#050505" />
        <View style={styles.imageViewer}>
          <IconButton
            icon={X}
            label="Fotoğrafı kapat"
            onPress={() => setImageViewerOpen(false)}
            style={{ ...styles.imageViewerClose, top: insets.top + spacing.sm }}
          />
          {event.imageUrl ? (
            <Image
              source={{ uri: compatibleEventImageUrl(event.imageUrl) }}
              resizeMode="contain"
              accessibilityLabel={`${event.title} etkinlik fotoğrafı`}
              style={styles.fullscreenImage}
            />
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={joinConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setJoinConfirmOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <AppText variant="heading20">Etkinliğe katıl</AppText>
            <AppText variant="body14" tone="secondary">
              Katılımın beyana dayanır. Etkinlik odası açıldığında sohbet ve bu
              etkinliğe özel eşleşme alanına erişebilirsin.
            </AppText>
            <AppButton
              label="Katıl"
              loading={attendance.isPending}
              onPress={() => attendance.mutate({ event, join: true })}
            />
            <AppButton
              label="Vazgeç"
              variant="ghost"
              onPress={() => setJoinConfirmOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
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

function sourceToken(value: string): string {
  const token = value.split('/').at(-1) ?? value;
  const labels: Record<string, string> = {
    EventScheduled: 'Planlandı',
    EventCancelled: 'İptal edildi',
    EventPostponed: 'Ertelendi',
    EventRescheduled: 'Tarihi değişti',
    OfflineEventAttendanceMode: 'Yüz yüze',
    OnlineEventAttendanceMode: 'Çevrim içi',
    MixedEventAttendanceMode: 'Hibrit',
    InStock: 'Bilet mevcut',
    SoldOut: 'Tükendi',
    PreOrder: 'Ön satışta',
  };
  return labels[token] ?? token.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function durationLabel(value: string): string {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return value;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return [hours ? `${hours} saat` : '', minutes ? `${minutes} dakika` : '']
    .filter(Boolean)
    .join(' ');
}

function SourceDetails({ details }: { details: EventSourceDetails }) {
  const price = details.isAccessibleForFree
    ? 'Ücretsiz'
    : details.price
    ? `${details.price}${details.currency ? ` ${details.currency}` : ''}`
    : null;
  const rows: Array<{
    icon: typeof CalendarDays;
    label: string;
    value: string | null;
  }> = [
    {
      icon: InfoIcon,
      label: 'Etkinlik durumu',
      value: details.status ? sourceToken(details.status) : null,
    },
    {
      icon: UsersRound,
      label: 'Katılım biçimi',
      value: details.attendanceMode
        ? sourceToken(details.attendanceMode)
        : null,
    },
    { icon: UserRound, label: 'Düzenleyen', value: details.organizer },
    {
      icon: UsersRound,
      label: 'Sahne / konuşmacılar',
      value: details.performers.length ? details.performers.join(', ') : null,
    },
    { icon: Ticket, label: 'Ücret', value: price },
    {
      icon: Ticket,
      label: 'Bilet durumu',
      value: details.availability ? sourceToken(details.availability) : null,
    },
    { icon: UserRound, label: 'Yaş aralığı', value: details.ageRange },
    {
      icon: Clock3,
      label: 'Kapı açılışı',
      value: details.doorTime ? formatEventDate(details.doorTime) : null,
    },
    {
      icon: Clock3,
      label: 'Süre',
      value: details.duration ? durationLabel(details.duration) : null,
    },
    {
      icon: CalendarDays,
      label: 'Kaynak güncellemesi',
      value: details.updatedAt ? formatEventDate(details.updatedAt) : null,
    },
  ].filter(row => Boolean(row.value));

  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="heading18">Kaynak detayları</AppText>
      <View style={styles.infoCard}>
        {rows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <View style={styles.infoDivider} /> : null}
            <InfoRow
              icon={row.icon}
              label={row.label}
              value={row.value ?? ''}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={19} color={colors.brand} />
      </View>
      <View style={styles.infoText}>
        <AppText variant="tiny11" tone="secondary">
          {label}
        </AppText>
        <AppText variant="label14">{value}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loadingScreen: { paddingBottom: spacing.xl },
  errorScreen: { backgroundColor: colors.canvas },
  errorHeader: {
    height: 64,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  heroWrap: { height: 280, backgroundColor: colors.surfaceMuted },
  heroPressable: { width: '100%', height: '100%' },
  hero: { width: '100%', height: '100%' },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroShade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(16, 24, 40, 0.12)',
  },
  overlayButton: {
    position: 'absolute',
    left: spacing.md,
    borderWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  imageViewer: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#050505',
  },
  fullscreenImage: { width: '100%', height: '100%' },
  imageViewerClose: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 2,
    borderWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  contentSheet: {
    ...shadows.card,
    marginTop: -24,
    minHeight: 460,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  topMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  categoryBadge: {
    maxWidth: '48%',
    borderRadius: 6,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, gap: 2 },
  infoDivider: { height: 1, marginLeft: 50, backgroundColor: colors.border },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  secondaryCategory: {
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  section: { gap: spacing.sm },
  descriptionToggle: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  pressed: { opacity: 0.7 },
  notice: {
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  sourceNotice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  noticeText: { flex: 1 },
  profileGate: {
    borderWidth: 1,
    borderColor: colors.brandSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  profileGateHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  profileGateCopy: { flex: 1, gap: 3 },
  profileStepList: { gap: spacing.xs },
  profileStep: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  profileStepBullet: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  profileStepLabel: { flex: 1 },
  profileGateLink: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  fixedAction: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  joinedActions: { flexDirection: 'row', gap: spacing.xs },
  joinedAction: { flex: 1, paddingHorizontal: spacing.xs },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  confirmSheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
  },
  heroSkeleton: { height: 280 },
  titleSkeleton: { height: 72, margin: spacing.md },
  bodySkeleton: { height: 260, marginHorizontal: spacing.md },
});

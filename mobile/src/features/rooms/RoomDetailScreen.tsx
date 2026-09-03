import type { RoomsStackParamList } from '@app/navigation/types';
import { getEvent, leaveEvent } from '@features/events/eventService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ChatComposer,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { legalDocumentUrls } from '@shared/legal/documents';
import {
  enqueueOutbox,
  listOutbox,
  removeFromOutbox,
} from '@shared/lib/chatOutbox';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import { colors, layout, radius, spacing } from '@shared/theme';
import type { RoomMessage } from '@shared/types/domain';
import { FlashList } from '@shopify/flash-list';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Flag,
  HeartHandshake,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  UsersRound,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { RoomMessageBubble } from './RoomMessageBubble';
import { listRoomParticipants } from './roomParticipantsService';
import { formatPostEventRemaining, getRoomState } from './roomRules';
import {
  listRoomMessages,
  markRoomRead,
  sendRoomMessage,
  submitRoomReport,
} from './roomService';
import type { RoomPage } from './roomTypes';
import { RoomTypingIndicator } from './RoomTypingIndicator';
import { useRoomRealtime } from './useRoomRealtime';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomDetail'>;

export function RoomDetailScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomMessage[]>([]);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionBusy, setOptionBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [frozenNotice, setFrozenNotice] = useState<string | null>(null);
  const frozenNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportRequestId = useRef<string | null>(null);
  const event = useQuery({
    queryKey: queryKeys.events.detail(route.params.eventId),
    queryFn: ({ signal }) => getEvent(route.params.eventId, signal),
  });
  const messages = useInfiniteQuery({
    queryKey: queryKeys.rooms.messages(route.params.eventId),
    queryFn: ({ pageParam, signal }) =>
      listRoomMessages(route.params.eventId, pageParam, signal),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: page => page.nextCursor,
  });
  const participants = useQuery({
    queryKey: queryKeys.rooms.participants(route.params.eventId),
    queryFn: () => listRoomParticipants(route.params.eventId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });
  const persisted = useMemo(
    () => messages.data?.pages.flatMap(page => page.items) ?? [],
    [messages.data],
  );
  const items = useMemo(() => {
    const persistedClientIds = new Set(
      persisted.map(message => message.clientMessageId),
    );
    return [
      ...pending.filter(
        message => !persistedClientIds.has(message.clientMessageId),
      ),
      ...persisted,
    ];
  }, [pending, persisted]);

  const clearUnreadCount = useCallback(() => {
    queryClient.setQueriesData<InfiniteData<RoomPage>>(
      { queryKey: queryKeys.rooms.all },
      current =>
        current
          ? {
              ...current,
              pages: current.pages.map(page => ({
                ...page,
                items: page.items.map(room =>
                  room.eventId === route.params.eventId
                    ? { ...room, unreadCount: 0 }
                    : room,
                ),
              })),
            }
          : current,
    );
  }, [queryClient, route.params.eventId]);

  const markCurrentRoomRead = useCallback(async () => {
    // The room list may still be mounted behind this screen. Clear its cache
    // synchronously so the badge disappears without waiting for a refetch.
    clearUnreadCount();
    await markRoomRead(route.params.eventId);
    clearUnreadCount();
    await queryClient.invalidateQueries({
      queryKey: queryKeys.rooms.all,
      refetchType: 'none',
    });
  }, [clearUnreadCount, queryClient, route.params.eventId]);

  const refreshMessages = useCallback(() => {
    clearUnreadCount();
    void queryClient.invalidateQueries({
      queryKey: queryKeys.rooms.messages(route.params.eventId),
    });
    void markCurrentRoomRead().catch(() => undefined);
  }, [
    clearUnreadCount,
    markCurrentRoomRead,
    queryClient,
    route.params.eventId,
  ]);
  const roomRealtime = useRoomRealtime({
    eventId: route.params.eventId,
    currentUserId: userId,
    onMessage: refreshMessages,
  });
  const typingParticipants = useMemo(() => {
    const byId = new Map(
      (participants.data ?? []).map(participant => [
        participant.id,
        participant,
      ]),
    );
    return roomRealtime.typingUserIds.flatMap(typingUserId => {
      const participant = byId.get(typingUserId);
      return participant ? [participant] : [];
    });
  }, [participants.data, roomRealtime.typingUserIds]);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearInterval(clock);
      if (frozenNoticeTimer.current) clearTimeout(frozenNoticeTimer.current);
    };
  }, []);

  const showFrozenNotice = useCallback((message: string) => {
    if (frozenNoticeTimer.current) clearTimeout(frozenNoticeTimer.current);
    setFrozenNotice(message);
    frozenNoticeTimer.current = setTimeout(() => {
      setFrozenNotice(null);
      frozenNoticeTimer.current = null;
    }, 2_800);
  }, []);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const currentUserId = data.user?.id ?? null;
      setUserId(currentUserId);
      if (!currentUserId) return;
      void listOutbox(currentUserId, 'room', route.params.eventId).then(
        outbox => {
          setPending(
            outbox.map(message => ({
              id: message.clientMessageId,
              eventId: route.params.eventId,
              senderId: currentUserId,
              senderName: 'Sen',
              senderPhotoUrl: null,
              body: message.body,
              clientMessageId: message.clientMessageId,
              createdAt: message.createdAt,
              status: 'failed',
            })),
          );
        },
      );
    });
    void markCurrentRoomRead().catch(() => undefined);
  }, [markCurrentRoomRead, route.params.eventId]);

  function confirmLeave() {
    setOptionsVisible(false);
    if (roomFrozen) {
      showFrozenNotice(
        'Bu oda arşivlendiği için etkinlikten ayrılma işlemi donduruldu.',
      );
      return;
    }
    Alert.alert(
      'Etkinlikten ayrıl',
      'Odadan çıkacak ve bu etkinliğe özel eşleşme alanına erişemeyeceksin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Ayrıl',
          style: 'destructive',
          onPress: () => {
            setOptionBusy(true);
            void leaveEvent(route.params.eventId)
              .then(() => {
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.rooms.all,
                });
                void queryClient.invalidateQueries({
                  queryKey: queryKeys.events.all,
                });
                navigation.popToTop();
              })
              .catch(error =>
                Alert.alert('Ayrılma başarısız', toAppError(error).message),
              )
              .finally(() => setOptionBusy(false));
          },
        },
      ],
    );
  }

  function confirmReport() {
    Alert.alert(
      'Odayı bildir',
      'Bu odanın moderasyon ekibi tarafından incelenmesini ister misin?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Bildir',
          style: 'destructive',
          onPress: () => {
            reportRequestId.current ??= createClientId();
            setOptionBusy(true);
            void submitRoomReport(route.params.eventId, reportRequestId.current)
              .then(() => {
                reportRequestId.current = null;
                setOptionsVisible(false);
                Alert.alert(
                  'Rapor alındı',
                  'Oda güvenlik inceleme kuyruğuna eklendi.',
                );
              })
              .catch(error =>
                Alert.alert('Rapor gönderilemedi', toAppError(error).message),
              )
              .finally(() => setOptionBusy(false));
          },
        },
      ],
    );
  }

  async function deliver(message: RoomMessage) {
    try {
      await sendRoomMessage(
        route.params.eventId,
        message.body,
        message.clientMessageId,
      );
      setPending(current =>
        current.map(item =>
          item.clientMessageId === message.clientMessageId
            ? { ...item, status: 'sent' }
            : item,
        ),
      );
      if (userId) {
        void removeFromOutbox(userId, message.clientMessageId).catch(
          () => undefined,
        );
      }
      refreshMessages();
    } catch (error) {
      captureAppError(error, { operation: 'message.room_send' });
      setPending(current =>
        current.map(item =>
          item.clientMessageId === message.clientMessageId
            ? { ...item, status: 'failed' }
            : item,
        ),
      );
    }
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > 700 || !userId) return;
    const createdAt = new Date().toISOString();
    const clientMessageId = createClientId();
    const optimistic: RoomMessage = {
      id: clientMessageId,
      eventId: route.params.eventId,
      senderId: userId,
      senderName: 'Sen',
      senderPhotoUrl: null,
      body: trimmed,
      clientMessageId,
      createdAt,
      status: 'sending',
    };
    setBody('');
    roomRealtime.stopTyping();
    setPending(current => [optimistic, ...current]);
    try {
      await enqueueOutbox({
        ownerId: userId,
        kind: 'room',
        contextId: route.params.eventId,
        clientMessageId,
        body: trimmed,
        createdAt,
        attempt: 0,
        nextAttemptAt: createdAt,
      });
    } catch (error) {
      captureAppError(error, { operation: 'message.room_outbox_enqueue' });
      setPending(current =>
        current.map(item =>
          item.clientMessageId === clientMessageId
            ? { ...item, status: 'failed' }
            : item,
        ),
      );
      return;
    }
    await deliver(optimistic);
  }

  function openFailed(message: RoomMessage) {
    Alert.alert(
      'Mesaj gönderilemedi',
      'İnternet bağlantını kontrol edip yeniden deneyebilirsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'İptal et',
          style: 'destructive',
          onPress: () => {
            if (userId) void removeFromOutbox(userId, message.clientMessageId);
            setPending(current =>
              current.filter(
                item => item.clientMessageId !== message.clientMessageId,
              ),
            );
          },
        },
        {
          text: 'Tekrar gönder',
          onPress: () => {
            setPending(current =>
              current.map(item =>
                item.clientMessageId === message.clientMessageId
                  ? { ...item, status: 'sending' }
                  : item,
              ),
            );
            void deliver({ ...message, status: 'sending' });
          },
        },
      ],
    );
  }

  if (event.isLoading || messages.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.headerSkeleton} />
        <Skeleton style={styles.messagesSkeleton} />
      </Screen>
    );
  if (event.isError || !event.data || messages.isError)
    return (
      <Screen>
        <ErrorState
          title="Oda açılamadı"
          description="Oda bilgileri şu anda yüklenemedi. Bağlantını kontrol edip yeniden dene."
          actionLabel="Tekrar dene"
          onAction={() => {
            void event.refetch();
            void messages.refetch();
          }}
        />
      </Screen>
    );
  const state = getRoomState(event.data.startAt, event.data.endAt, now);
  const roomFrozen = state === 'archived';
  const writable = state === 'active' || state === 'postEvent';
  const stateLabel =
    state === 'active'
      ? 'Aktif'
      : state === 'postEvent'
      ? formatPostEventRemaining(event.data.startAt, event.data.endAt, now)
      : state === 'locked'
      ? 'Yakında'
      : 'Arşiv';
  const stateMessage =
    state === 'locked'
      ? 'Sohbet etkinlikten 13 gün önce açılır.'
      : 'Bu oda arşivlendi. Mesajları okuyabilirsin; yeni mesaj gönderilemez.';

  return (
    <Screen contentStyle={styles.screen} testID="room-detail-screen">
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Etkinlik detayını aç"
          onPress={() =>
            navigation.navigate('EventDetail', {
              eventId: route.params.eventId,
            })
          }
          style={styles.eventHeading}
        >
          <AppText variant="label15" numberOfLines={1}>
            {event.data.title}
          </AppText>
          <AppText variant="caption12" tone="secondary">
            Etkinlik odası · {stateLabel}
          </AppText>
        </Pressable>
        <IconButton
          icon={HeartHandshake}
          label={roomFrozen ? 'Eşleşme alanı donduruldu' : 'Eşleşme alanını aç'}
          accessibilityState={{ disabled: roomFrozen }}
          style={roomFrozen ? styles.frozenAction : undefined}
          onPress={() => {
            if (roomFrozen) {
              showFrozenNotice(
                'Bu oda arşivlendiği için eşleşme alanı donduruldu.',
              );
              return;
            }
            navigation.navigate('MatchHub', {
              eventId: route.params.eventId,
            });
          }}
        />
        <IconButton
          icon={MoreHorizontal}
          label="Oda seçenekleri"
          onPress={() => setOptionsVisible(true)}
        />
      </View>
      {frozenNotice ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.frozenNotice}
        >
          <LockKeyhole size={18} color={colors.textInverse} />
          <AppText
            variant="body14"
            tone="inverse"
            style={styles.frozenNoticeText}
          >
            {frozenNotice}
          </AppText>
        </View>
      ) : null}
      {items.length === 0 ? (
        <StateView
          title={
            state === 'locked' ? 'Oda henüz açılmadı' : 'İlk mesajı sen gönder'
          }
          description={
            state === 'locked'
              ? stateMessage
              : 'Etkinlik hakkında konuşmayı başlat. Topluluk kurallarına uygun ve saygılı ol.'
          }
        />
      ) : (
        <FlashList
          data={items}
          inverted
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <RoomMessageBubble
              message={item}
              mine={item.senderId === userId || item.senderName === 'Sen'}
              onFailed={() => openFailed(item)}
            />
          )}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage)
              void messages.fetchNextPage();
          }}
        />
      )}
      {typingParticipants.length > 0 ? (
        <RoomTypingIndicator participants={typingParticipants} />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {writable ? (
          <ChatComposer
            accessibilityLabel="Odaya mesaj yaz"
            value={body}
            onChangeText={value => {
              setBody(value);
              roomRealtime.notifyTyping(value);
            }}
            onBlur={roomRealtime.stopTyping}
            onSend={() => void submit()}
          />
        ) : (
          <View style={styles.lockedComposer}>
            <CalendarDays size={18} color={colors.textSecondary} />
            <AppText
              variant="body14"
              tone="secondary"
              style={styles.lockedText}
            >
              {stateMessage}
            </AppText>
          </View>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={optionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Oda seçeneklerini kapat"
          onPress={() => setOptionsVisible(false)}
          style={styles.sheetBackdrop}
        >
          {/* A Pressable is an accessibility element by default, which would
              collapse the whole sheet into one VoiceOver node and hide the
              options inside it. This one only blocks backdrop taps. */}
          <Pressable
            accessible={false}
            onPress={pressEvent => pressEvent.stopPropagation()}
            style={styles.sheet}
            accessibilityViewIsModal
          >
            <View style={styles.sheetHandle} />
            <AppText variant="label15" tone="secondary">
              Oda Seçenekleri
            </AppText>
            <View style={styles.sheetActions}>
              <OptionRow
                icon={UsersRound}
                label="Katılımcıları Gör"
                onPress={() => {
                  setOptionsVisible(false);
                  navigation.navigate('RoomParticipants', {
                    eventId: route.params.eventId,
                  });
                }}
              />
              <OptionRow
                icon={ShieldCheck}
                label="Topluluk Kuralları"
                onPress={() => {
                  setOptionsVisible(false);
                  void Linking.openURL(legalDocumentUrls.community).catch(() =>
                    Alert.alert(
                      'Bağlantı açılamadı',
                      'İnternet bağlantını kontrol edip tekrar dene.',
                    ),
                  );
                }}
              />
              <OptionRow
                icon={LogOut}
                label="Etkinlikten Ayrıl"
                blocked={roomFrozen}
                onPress={confirmLeave}
              />
              <OptionRow
                icon={Flag}
                label="Odayı Bildir"
                danger
                disabled={optionBusy}
                onPress={confirmReport}
              />
            </View>
            <AppButton
              label="İptal"
              variant="secondary"
              onPress={() => setOptionsVisible(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function OptionRow({
  icon: Icon,
  label,
  onPress,
  danger = false,
  disabled = false,
  blocked = false,
}: {
  icon: typeof UsersRound;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  blocked?: boolean;
}) {
  const visuallyDisabled = disabled || blocked;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: visuallyDisabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        pressed && styles.optionPressed,
        visuallyDisabled && styles.optionDisabled,
      ]}
    >
      <Icon
        size={20}
        color={
          visuallyDisabled
            ? colors.textTertiary
            : danger
            ? colors.danger
            : colors.iconPrimary
        }
      />
      <AppText
        variant="label15"
        tone={visuallyDisabled ? 'tertiary' : danger ? 'danger' : 'primary'}
        style={styles.optionLabel}
      >
        {label}
      </AppText>
      <ChevronRight size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas },
  header: {
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  eventHeading: { flex: 1, minHeight: 48, justifyContent: 'center' },
  headerSkeleton: { height: layout.headerHeight },
  messagesSkeleton: { flex: 1, margin: spacing.md },
  frozenAction: { opacity: 0.45 },
  frozenNotice: {
    position: 'absolute',
    zIndex: 20,
    left: spacing.md,
    right: spacing.md,
    bottom: 88,
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.textPrimary,
  },
  frozenNoticeText: { flex: 1 },
  list: { padding: spacing.md },
  lockedComposer: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lockedText: { flex: 1 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    maxWidth: layout.maxModalWidth,
    maxHeight: '92%',
    alignSelf: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
  },
  sheetActions: { gap: spacing.xs },
  optionRow: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  optionPressed: { opacity: 0.72 },
  optionDisabled: { opacity: 0.45 },
  optionLabel: { flex: 1 },
});

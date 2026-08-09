import type { RoomsStackParamList } from '@app/navigation/types';
import { getEvent, leaveEvent } from '@features/events/eventService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { legalDocumentUrls } from '@shared/legal/documents';
import {
  enqueueOutbox,
  listOutbox,
  removeFromOutbox,
} from '@shared/lib/chatOutbox';
import { formatMessageDateTime } from '@shared/lib/date';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing, typography } from '@shared/theme';
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
  LogOut,
  MoreHorizontal,
  RotateCcw,
  Send,
  ShieldCheck,
  UsersRound,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  listRoomParticipants,
  type RoomParticipant,
} from './roomParticipantsService';
import { getRoomState } from './roomRules';
import {
  listRoomMessages,
  markRoomRead,
  sendRoomMessage,
  submitRoomReport,
} from './roomService';
import type { RoomPage } from './roomTypes';
import { useRoomRealtime } from './useRoomRealtime';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomDetail'>;

export function RoomDetailScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomMessage[]>([]);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionBusy, setOptionBusy] = useState(false);
  const event = useQuery({
    queryKey: ['event', route.params.eventId],
    queryFn: () => getEvent(route.params.eventId),
  });
  const messages = useInfiniteQuery({
    queryKey: ['room-messages', route.params.eventId],
    queryFn: ({ pageParam }) =>
      listRoomMessages(route.params.eventId, pageParam),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: page => page.nextCursor,
  });
  const participants = useQuery({
    queryKey: ['room-participants', route.params.eventId],
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
      { queryKey: ['rooms'] },
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
      queryKey: ['rooms'],
      refetchType: 'none',
    });
  }, [clearUnreadCount, queryClient, route.params.eventId]);

  const refreshMessages = useCallback(() => {
    clearUnreadCount();
    void queryClient.invalidateQueries({
      queryKey: ['room-messages', route.params.eventId],
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
    void supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
    void listOutbox('room', route.params.eventId).then(outbox => {
      setPending(
        outbox.map(message => ({
          id: message.clientMessageId,
          eventId: route.params.eventId,
          senderId: '',
          senderName: 'Sen',
          senderPhotoUrl: null,
          body: message.body,
          clientMessageId: message.clientMessageId,
          createdAt: message.createdAt,
          status: 'failed',
        })),
      );
    });
    void markCurrentRoomRead().catch(() => undefined);
  }, [markCurrentRoomRead, route.params.eventId]);

  function confirmLeave() {
    setOptionsVisible(false);
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
                void queryClient.invalidateQueries({ queryKey: ['rooms'] });
                void queryClient.invalidateQueries({ queryKey: ['events'] });
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
            setOptionBusy(true);
            void submitRoomReport(route.params.eventId)
              .then(() => {
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
      void removeFromOutbox(message.clientMessageId).catch(() => undefined);
      refreshMessages();
    } catch {
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
    const now = new Date().toISOString();
    const clientMessageId = createClientId();
    const optimistic: RoomMessage = {
      id: clientMessageId,
      eventId: route.params.eventId,
      senderId: userId,
      senderName: 'Sen',
      senderPhotoUrl: null,
      body: trimmed,
      clientMessageId,
      createdAt: now,
      status: 'sending',
    };
    setBody('');
    roomRealtime.stopTyping();
    setPending(current => [optimistic, ...current]);
    await enqueueOutbox({
      kind: 'room',
      contextId: route.params.eventId,
      clientMessageId,
      body: trimmed,
      createdAt: now,
    });
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
            void removeFromOutbox(message.clientMessageId);
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
  const state = getRoomState(event.data.startAt, event.data.endAt);
  const writable = state === 'active' || state === 'postEvent';
  const stateMessage =
    state === 'locked'
      ? 'Sohbet etkinlikten 13 gün önce açılır.'
      : 'Bu oda arşivlendi. Mesajları okuyabilirsin; yeni mesaj gönderilemez.';

  return (
    <Screen contentStyle={styles.screen}>
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
            Etkinlik odası ·{' '}
            {state === 'active'
              ? 'Aktif'
              : state === 'postEvent'
              ? 'Son 3 gün'
              : state === 'locked'
              ? 'Yakında'
              : 'Arşiv'}
          </AppText>
        </Pressable>
        <IconButton
          icon={HeartHandshake}
          label="Eşleşme alanını aç"
          onPress={() =>
            navigation.navigate('MatchHub', { eventId: route.params.eventId })
          }
        />
        <IconButton
          icon={MoreHorizontal}
          label="Oda seçenekleri"
          onPress={() => setOptionsVisible(true)}
        />
      </View>
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
            <MessageBubble
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
          <View style={styles.composerWrap}>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Odaya mesaj yaz"
                placeholder="Mesaj yaz..."
                placeholderTextColor={colors.textTertiary}
                value={body}
                onChangeText={value => {
                  setBody(value);
                  roomRealtime.notifyTyping(value);
                }}
                onBlur={roomRealtime.stopTyping}
                maxLength={contentLimits.message}
                multiline
                style={styles.input}
              />
              <IconButton
                icon={Send}
                label="Mesajı gönder"
                selected
                disabled={!body.trim()}
                onPress={() => void submit()}
              />
            </View>
            <AppText variant="tiny11" tone="tertiary" align="right">
              {body.length}/700
            </AppText>
          </View>
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
          <Pressable
            onPress={pressEvent => pressEvent.stopPropagation()}
            style={styles.sheet}
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

function RoomTypingIndicator({
  participants,
}: {
  participants: RoomParticipant[];
}) {
  const visible = participants.slice(0, 4);
  const names = visible.map(participant => participant.fullName);
  const label =
    names.length === 1
      ? `${names[0]} yazıyor...`
      : names.length === 2
      ? `${names[0]} ve ${names[1]} yazıyor...`
      : `${names.slice(0, -1).join(', ')} ve ${names.at(-1)} yazıyor...`;

  return (
    <View style={styles.typingIndicator} accessibilityLiveRegion="polite">
      <View style={styles.typingAvatars}>
        {visible.map((participant, index) =>
          participant.photoUrl ? (
            <Image
              key={participant.id}
              source={{ uri: participant.photoUrl }}
              accessibilityLabel={participant.fullName}
              style={[
                styles.typingAvatar,
                index > 0 && styles.typingAvatarOverlap,
              ]}
            />
          ) : (
            <View
              key={participant.id}
              accessibilityLabel={participant.fullName}
              style={[
                styles.typingAvatar,
                styles.typingAvatarFallback,
                index > 0 && styles.typingAvatarOverlap,
              ]}
            >
              <AppText variant="tiny11" tone="brand">
                {participant.fullName
                  .trim()
                  .charAt(0)
                  .toLocaleUpperCase('tr-TR')}
              </AppText>
            </View>
          ),
        )}
      </View>
      <AppText variant="caption12" tone="success" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function OptionRow({
  icon: Icon,
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: typeof UsersRound;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        pressed && styles.optionPressed,
        disabled && styles.optionDisabled,
      ]}
    >
      <Icon size={20} color={danger ? colors.danger : colors.iconPrimary} />
      <AppText
        variant="label15"
        tone={danger ? 'danger' : 'primary'}
        style={styles.optionLabel}
      >
        {label}
      </AppText>
      <ChevronRight size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function MessageBubble({
  message,
  mine,
  onFailed,
}: {
  message: RoomMessage;
  mine: boolean;
  onFailed: () => void;
}) {
  return (
    <Pressable
      disabled={message.status !== 'failed'}
      onPress={onFailed}
      style={[styles.messageRow, mine && styles.messageRowMine]}
      accessibilityRole={message.status === 'failed' ? 'button' : undefined}
      accessibilityLabel={
        message.status === 'failed'
          ? 'Başarısız mesaj. Yeniden göndermek için dokun'
          : undefined
      }
    >
      {!mine ? (
        message.senderPhotoUrl ? (
          <Image
            source={{ uri: message.senderPhotoUrl }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarFallback} />
        )
      ) : null}
      <View
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleOther,
          message.status === 'failed' && styles.bubbleFailed,
        ]}
      >
        {!mine ? (
          <AppText variant="caption12" tone="brand">
            {message.senderName}
          </AppText>
        ) : null}
        <AppText variant="body14" tone={mine ? 'inverse' : 'primary'}>
          {message.body}
        </AppText>
        <View style={styles.messageStatus}>
          {message.status === 'failed' ? (
            <RotateCcw
              size={12}
              color={mine ? colors.textInverse : colors.danger}
            />
          ) : null}
          <AppText variant="tiny11" tone={mine ? 'inverse' : 'tertiary'}>
            {message.status === 'sending'
              ? `Gönderiliyor · ${formatMessageDateTime(message.createdAt)}`
              : message.status === 'failed'
              ? `Başarısız · ${formatMessageDateTime(message.createdAt)}`
              : formatMessageDateTime(message.createdAt)}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas },
  header: {
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  eventHeading: { flex: 1, minHeight: 48, justifyContent: 'center' },
  headerSkeleton: { height: 64 },
  messagesSkeleton: { flex: 1, margin: spacing.md },
  list: { padding: spacing.md },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  messageRowMine: { justifyContent: 'flex-end' },
  avatar: { width: 30, height: 30, borderRadius: 15 },
  avatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceMuted,
  },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleFailed: { backgroundColor: colors.danger },
  messageStatus: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  typingIndicator: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  typingAvatars: { flexDirection: 'row', alignItems: 'center' },
  typingAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  typingAvatarOverlap: { marginLeft: -8 },
  typingAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  composer: {
    minHeight: 52,
    maxHeight: 128,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingLeft: spacing.sm,
    paddingRight: 4,
    paddingVertical: 4,
  },
  input: {
    ...typography.body15,
    color: colors.textPrimary,
    flex: 1,
    maxHeight: 112,
    paddingVertical: spacing.sm,
  },
  lockedComposer: {
    minHeight: 72,
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

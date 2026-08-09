import type { MessagesStackParamList } from '@app/navigation/types';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  StateView,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
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
import type { DirectMessage } from '@shared/types/domain';
import { FlashList } from '@shopify/flash-list';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  MoreVertical,
  RotateCcw,
  Send,
  Smile,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  blockUser,
  deleteMatchChat,
  endMatch,
  getMatch,
  listDirectMessages,
  markMatchRead,
  sendDirectMessage,
  subscribeToDirectMessages,
  unblockUser,
} from './messageService';
import { useConversationPresence } from './useConversationPresence';

type Props = NativeStackScreenProps<MessagesStackParamList, 'DirectChat'>;
type ReportReason =
  | 'fake_profile'
  | 'harassment'
  | 'spam'
  | 'nudity'
  | 'underage'
  | 'hate_speech'
  | 'other';

const reportReasons: Array<{ value: ReportReason; label: string }> = [
  { value: 'fake_profile', label: 'Sahte profil' },
  { value: 'harassment', label: 'Taciz' },
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Uygunsuz içerik' },
  { value: 'underage', label: 'Reşit değil' },
  { value: 'hate_speech', label: 'Nefret söylemi' },
  { value: 'other', label: 'Diğer' },
];

export function DirectChatScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [pending, setPending] = useState<DirectMessage[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const match = useQuery({
    queryKey: ['match', route.params.matchId],
    queryFn: () => getMatch(route.params.matchId),
  });
  const messages = useInfiniteQuery({
    queryKey: ['direct-messages', route.params.matchId],
    queryFn: ({ pageParam }) =>
      listDirectMessages(route.params.matchId, pageParam),
    initialPageParam: null as { createdAt: string; id: string } | null,
    getNextPageParam: page => page.nextCursor,
  });
  const persisted = useMemo(
    () => messages.data?.pages.flatMap(page => page.items) ?? [],
    [messages.data],
  );
  const items = useMemo(() => {
    const ids = new Set(persisted.map(item => item.clientMessageId));
    return [
      ...pending.filter(item => !ids.has(item.clientMessageId)),
      ...persisted,
    ];
  }, [pending, persisted]);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['direct-messages', route.params.matchId],
    });
    void queryClient.invalidateQueries({ queryKey: ['matches'] });
  }, [queryClient, route.params.matchId]);
  const writable = match.data?.status === 'active';
  const presence = useConversationPresence({
    currentUserId: userId,
    otherUserId: match.data?.otherUser.id ?? null,
    enabled: writable,
  });
  const setTyping = presence.setTyping;
  const markReadAndRefresh = useCallback(async () => {
    try {
      await markMatchRead(route.params.matchId);
    } finally {
      refresh();
    }
  }, [refresh, route.params.matchId]);

  useEffect(() => {
    void supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
    void listOutbox('direct', route.params.matchId).then(outbox =>
      setPending(
        outbox.map(item => ({
          id: item.clientMessageId,
          matchId: route.params.matchId,
          senderId: '',
          receiverId: '',
          body: item.body,
          clientMessageId: item.clientMessageId,
          readAt: null,
          createdAt: item.createdAt,
          status: 'failed',
        })),
      ),
    );
    return subscribeToDirectMessages(route.params.matchId, () => {
      void markReadAndRefresh().catch(() => refresh());
    });
  }, [markReadAndRefresh, refresh, route.params.matchId]);

  useFocusEffect(
    useCallback(() => {
      void markReadAndRefresh().catch(() => refresh());
      return () => setTyping(false);
    }, [markReadAndRefresh, refresh, setTyping]),
  );

  async function deliver(message: DirectMessage) {
    try {
      await sendDirectMessage(
        route.params.matchId,
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
      refresh();
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
    if (!trimmed || trimmed.length > 700 || !userId || !match.data) return;
    const createdAt = new Date().toISOString();
    const clientMessageId = createClientId();
    const optimistic: DirectMessage = {
      id: clientMessageId,
      matchId: route.params.matchId,
      senderId: userId,
      receiverId: match.data.otherUser.id,
      body: trimmed,
      clientMessageId,
      readAt: null,
      createdAt,
      status: 'sending',
    };
    setBody('');
    presence.setTyping(false);
    setPending(current => [optimistic, ...current]);
    await enqueueOutbox({
      kind: 'direct',
      contextId: route.params.matchId,
      clientMessageId,
      body: trimmed,
      createdAt,
    });
    await deliver(optimistic);
  }
  function openFailed(message: DirectMessage) {
    Alert.alert(
      'Mesaj gönderilemedi',
      'Mesaj güvenli gönderim kuyruğunda tutuluyor.',
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
  function confirmEnd() {
    setMenuVisible(false);
    Alert.alert(
      'Eşleşmeyi bitir',
      'Geçmiş korunur fakat yeni mesaj gönderilemez. Devam edilsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Eşleşmeyi bitir',
          style: 'destructive',
          onPress: () => {
            void endMatch(route.params.matchId)
              .then(() => {
                queryClient.setQueryData(
                  ['match', route.params.matchId],
                  match.data ? { ...match.data, status: 'ended' } : undefined,
                );
                refresh();
              })
              .catch(error =>
                Alert.alert('İşlem tamamlanamadı', toAppError(error).message),
              );
          },
        },
      ],
    );
  }
  function confirmBlock() {
    if (!match.data) return;
    setMenuVisible(false);
    Alert.alert(
      'Kullanıcıyı engelle',
      'Birbirinizi keşfette göremez ve mesajlaşamazsınız.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Engelle',
          style: 'destructive',
          onPress: () => {
            void blockUser(match.data.otherUser.id)
              .then(() => {
                queryClient.setQueryData(['match', route.params.matchId], {
                  ...match.data,
                  status: 'blocked',
                  blockedByMe: true,
                });
                refresh();
              })
              .catch(error =>
                Alert.alert('Engellenemedi', toAppError(error).message),
              );
          },
        },
      ],
    );
  }
  function confirmUnblock() {
    if (!match.data) return;
    setMenuVisible(false);
    Alert.alert(
      'Engeli kaldır',
      'Engel kaldırılır; önceki eşleşme ve mesajlaşma otomatik olarak yeniden açılmaz.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Engeli kaldır',
          onPress: () => {
            void unblockUser(match.data.otherUser.id)
              .then(() => {
                queryClient.setQueryData(['match', route.params.matchId], {
                  ...match.data,
                  status: 'ended',
                  blockedByMe: false,
                });
                refresh();
              })
              .catch(error =>
                Alert.alert('Engel kaldırılamadı', toAppError(error).message),
              );
          },
        },
      ],
    );
  }
  async function removeChat(mode: 'end' | 'block') {
    try {
      await deleteMatchChat(route.params.matchId, mode);
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      queryClient.removeQueries({
        queryKey: ['direct-messages', route.params.matchId],
      });
      navigation.goBack();
    } catch (error) {
      Alert.alert('Sohbet kaldırılamadı', toAppError(error).message);
    }
  }
  function confirmDelete() {
    setMenuVisible(false);
    Alert.alert(
      'Sohbeti sil',
      'Sohbet yalnızca senin listenden kaldırılır. Güvenliğiniz için önce eşleşmeyi bitirebilir veya kullanıcıyı engelleyebilirsin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Bitir ve kaldır',
          style: 'destructive',
          onPress: () => void removeChat('end'),
        },
        {
          text: 'Engelle ve kaldır',
          style: 'destructive',
          onPress: () => void removeChat('block'),
        },
      ],
    );
  }
  async function submitReport(blockAfter: boolean) {
    if (!match.data || reportDetails.trim().length < 20) return;
    setReportBusy(true);
    const { error } = await supabase.rpc('submit_report', {
      target_user_id: match.data.otherUser.id,
      reason: reportReason,
      details: reportDetails.trim(),
      target_event_id: match.data.eventId,
      target_match_id: match.data.id,
      client_context: { platform: Platform.OS },
      block_after: blockAfter,
    });
    setReportBusy(false);
    if (error) {
      Alert.alert('Rapor gönderilemedi', error.message);
      return;
    }
    setReportVisible(false);
    setReportDetails('');
    setMenuVisible(false);
    Alert.alert(
      'Rapor alındı',
      'Raporun güvenlik ekibinin inceleme kuyruğuna eklendi.',
    );
    if (blockAfter) {
      void match.refetch();
      refresh();
    }
  }

  if (match.isLoading || messages.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.headerSkeleton} />
        <Skeleton style={styles.messagesSkeleton} />
      </Screen>
    );
  if (match.isError || !match.data || messages.isError)
    return (
      <Screen>
        <ErrorState
          title="Sohbet açılamadı"
          description="Sohbet silinmiş, erişimin kapanmış veya bağlantın kesilmiş olabilir."
          actionLabel="Mesajlara dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  const primaryPhoto = match.data.otherUser.photos[0];
  const peerStatus =
    match.data.status === 'blocked'
      ? match.data.blockedByMe
        ? 'Engelledin · Sohbet kilitli'
        : 'Bu kullanıcı seni engelledi'
      : match.data.status === 'ended'
      ? 'Eşleşme sona erdi'
      : presence.otherTyping
      ? 'Yazıyor...'
      : presence.otherOnline
      ? 'Çevrimiçi'
      : 'Çevrimdışı';
  const livePeerStatus =
    writable && (presence.otherTyping || presence.otherOnline);
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.plainHeaderButton}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${match.data.otherUser.fullName} profilini aç`}
          onPress={() =>
            navigation.navigate('PublicProfile', {
              userId: match.data.otherUser.id,
            })
          }
          style={styles.profileHeader}
        >
          <View style={styles.headerAvatarWrap}>
            {primaryPhoto ? (
              <Image
                source={{ uri: primaryPhoto.url }}
                style={styles.headerAvatar}
              />
            ) : (
              <View style={styles.headerAvatar} />
            )}
            {presence.otherOnline ? (
              <View style={styles.headerOnlineDot} />
            ) : null}
          </View>
          <View style={styles.headerName}>
            <AppText variant="label15" numberOfLines={1}>
              {match.data.otherUser.fullName}
            </AppText>
            <View style={styles.presenceStatus}>
              {livePeerStatus ? <View style={styles.inlineStatusDot} /> : null}
              <AppText
                variant="tiny11"
                tone={livePeerStatus ? 'success' : 'secondary'}
                numberOfLines={1}
              >
                {peerStatus}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${match.data.eventTitle} etkinliğini aç`}
              onPress={eventPress => {
                eventPress.stopPropagation();
                navigation.navigate('EventDetail', {
                  eventId: match.data.eventId,
                });
              }}
              style={styles.eventPill}
            >
              <AppText variant="tiny11" tone="brand" numberOfLines={1}>
                {match.data.eventTitle} etkinliğinde eşleştiniz
              </AppText>
            </Pressable>
          </View>
        </Pressable>
        <IconButton
          icon={MoreVertical}
          label="Sohbet seçenekleri"
          onPress={() => setMenuVisible(true)}
          style={styles.plainHeaderButton}
        />
      </View>
      {items.length === 0 ? (
        <StateView
          title="Yeni eşleşme"
          description={`${match.data.otherUser.fullName} ile bu etkinlik sayesinde eşleştiniz. İlk mesajı göndererek tanışmaya başlayabilirsin.`}
        />
      ) : (
        <FlashList
          data={items}
          inverted
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <DirectBubble
              message={item}
              mine={item.senderId === userId || item.senderId === ''}
              otherPhotoUrl={primaryPhoto?.url ?? null}
              onFailed={() => openFailed(item)}
            />
          )}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage)
              void messages.fetchNextPage();
          }}
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {writable ? (
          <View style={styles.composerWrap}>
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Özel mesaj yaz"
                placeholder="Mesaj yaz..."
                placeholderTextColor={colors.textTertiary}
                value={body}
                maxLength={contentLimits.message}
                multiline
                onChangeText={value => {
                  setBody(value);
                  presence.setTyping(Boolean(value.trim()));
                }}
                onBlur={() => presence.setTyping(false)}
                style={styles.input}
              />
              <IconButton
                icon={Smile}
                label="Gülümseme ekle"
                onPress={() =>
                  setBody(current =>
                    current.length < contentLimits.message
                      ? `${current}😊`
                      : current,
                  )
                }
                style={styles.composerAction}
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
          <View style={styles.locked}>
            <AppText variant="body14" tone="secondary" align="center">
              {match.data.status === 'blocked'
                ? 'Bu sohbet engelleme nedeniyle kilitli. Geçmiş mesajları okuyabilirsin.'
                : 'Bu eşleşme sona erdi. Geçmiş mesajları okuyabilirsin.'}
            </AppText>
          </View>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.sheet}>
            <AppText variant="heading20">Sohbet seçenekleri</AppText>
            <AppButton
              label="Sohbet gizlilik ayarları"
              variant="secondary"
              onPress={() => {
                setMenuVisible(false);
                navigation.navigate('ChatSettings', {
                  matchId: route.params.matchId,
                });
              }}
            />
            <AppButton
              label="Eşleşmeyi bitir"
              variant="secondary"
              disabled={!writable}
              onPress={confirmEnd}
            />
            <AppButton
              label="Şikâyet et"
              variant="secondary"
              onPress={() => setReportVisible(true)}
            />
            <AppButton
              label={
                match.data.blockedByMe
                  ? 'Engeli kaldır'
                  : match.data.status === 'blocked'
                  ? 'Karşı taraf seni engelledi'
                  : 'Engelle'
              }
              variant="danger"
              disabled={
                match.data.status === 'blocked' && !match.data.blockedByMe
              }
              onPress={match.data.blockedByMe ? confirmUnblock : confirmBlock}
            />
            <AppButton
              label="Sohbeti sil"
              variant="ghost"
              onPress={confirmDelete}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal
        visible={reportVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.reportSheet}>
            <AppText variant="heading20">Kullanıcıyı şikâyet et</AppText>
            <View style={styles.reasonChips}>
              {reportReasons.map(reason => (
                <Chip
                  key={reason.value}
                  label={reason.label}
                  selected={reportReason === reason.value}
                  onPress={() => setReportReason(reason.value)}
                />
              ))}
            </View>
            <TextField
              label="Açıklama"
              value={reportDetails}
              onChangeText={setReportDetails}
              maxLength={contentLimits.reportDetails}
              multiline
              numberOfLines={5}
              hint="En az 20 karakter; kişisel veya hassas bilgi paylaşma."
            />
            <AppButton
              label="Raporla"
              loading={reportBusy}
              disabled={reportDetails.trim().length < 20}
              onPress={() => void submitReport(false)}
            />
            <AppButton
              label="Raporla ve engelle"
              variant="danger"
              loading={reportBusy}
              disabled={reportDetails.trim().length < 20}
              onPress={() => void submitReport(true)}
            />
            <AppButton
              label="Vazgeç"
              variant="ghost"
              onPress={() => setReportVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function DirectBubble({
  message,
  mine,
  otherPhotoUrl,
  onFailed,
}: {
  message: DirectMessage;
  mine: boolean;
  otherPhotoUrl: string | null;
  onFailed: () => void;
}) {
  return (
    <Pressable
      disabled={message.status !== 'failed'}
      onPress={onFailed}
      style={[styles.messageRow, mine && styles.messageRowMine]}
    >
      {!mine ? (
        otherPhotoUrl ? (
          <Image source={{ uri: otherPhotoUrl }} style={styles.messageAvatar} />
        ) : (
          <View style={styles.messageAvatar} />
        )
      ) : null}
      <View style={[styles.messageColumn, mine && styles.messageColumnMine]}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleOther,
            message.status === 'failed' && styles.bubbleFailed,
          ]}
        >
          <AppText variant="body14" tone={mine ? 'inverse' : 'primary'}>
            {message.body}
          </AppText>
        </View>
        <View style={[styles.status, mine && styles.statusMine]}>
          {message.status === 'sending' && mine ? (
            <Clock3 size={12} color={colors.textTertiary} />
          ) : message.status === 'failed' ? (
            <RotateCcw size={12} color={colors.danger} />
          ) : message.status === 'read' && mine ? (
            <CheckCheck size={14} color={colors.brand} />
          ) : mine ? (
            <Check size={13} color={colors.textTertiary} />
          ) : null}
          <AppText variant="tiny11" tone="tertiary">
            {message.status === 'sending'
              ? `Gönderiliyor · ${formatMessageDateTime(message.createdAt)}`
              : message.status === 'failed'
              ? `Başarısız · ${formatMessageDateTime(message.createdAt)}`
              : message.status === 'read' && mine
              ? `Okundu · ${formatMessageDateTime(message.createdAt)}`
              : mine
              ? `Gönderildi · ${formatMessageDateTime(message.createdAt)}`
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
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.brandSubtle,
  },
  plainHeaderButton: { borderWidth: 0, backgroundColor: colors.transparent },
  profileHeader: {
    flex: 1,
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
  },
  headerAvatarWrap: { position: 'relative' },
  headerOnlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.brandSubtle,
    backgroundColor: colors.success,
  },
  headerName: { flex: 1, gap: 1 },
  presenceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inlineStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  eventPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 2,
    borderWidth: 1,
    borderColor: colors.brandSoft,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  headerSkeleton: { height: 64 },
  messagesSkeleton: { flex: 1, margin: spacing.md },
  list: { padding: spacing.md },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
  },
  messageRowMine: { justifyContent: 'flex-end' },
  messageAvatar: {
    width: 28,
    height: 28,
    marginRight: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
  },
  messageColumn: { maxWidth: '78%', alignItems: 'flex-start' },
  messageColumnMine: { alignItems: 'flex-end' },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleFailed: { backgroundColor: colors.danger },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
  },
  statusMine: { alignSelf: 'flex-end' },
  composerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
  composerAction: {
    width: 40,
    height: 40,
    borderWidth: 0,
    backgroundColor: colors.transparent,
  },
  locked: {
    minHeight: 72,
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  reportSheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});

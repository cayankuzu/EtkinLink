import type { MessagesStackParamList } from '@app/navigation/types';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppImage,
  AppText,
  ChatComposer,
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
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import { captureAppError } from '@shared/lib/telemetry';
import { colors, layout, radius, spacing } from '@shared/theme';
import type { DirectMessage } from '@shared/types/domain';
import { FlashList } from '@shopify/flash-list';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowLeft, MoreVertical } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { DirectMessageBubble } from './DirectMessageBubble';
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
    queryKey: queryKeys.messages.match(route.params.matchId),
    queryFn: ({ signal }) => getMatch(route.params.matchId, signal),
  });
  const messages = useInfiniteQuery({
    queryKey: queryKeys.messages.direct(route.params.matchId),
    queryFn: ({ pageParam, signal }) =>
      listDirectMessages(route.params.matchId, pageParam, signal),
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
      queryKey: queryKeys.messages.direct(route.params.matchId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.messages.matches,
    });
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
    void supabase.auth.getUser().then(({ data }) => {
      const currentUserId = data.user?.id ?? null;
      setUserId(currentUserId);
      if (!currentUserId) return;
      void listOutbox(currentUserId, 'direct', route.params.matchId).then(
        outbox =>
          setPending(
            outbox.map(item => ({
              id: item.clientMessageId,
              matchId: route.params.matchId,
              senderId: currentUserId,
              receiverId: '',
              body: item.body,
              clientMessageId: item.clientMessageId,
              readAt: null,
              createdAt: item.createdAt,
              status: 'failed',
            })),
          ),
      );
    });
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
      if (userId) {
        void removeFromOutbox(userId, message.clientMessageId).catch(
          () => undefined,
        );
      }
      refresh();
    } catch (error) {
      captureAppError(error, { operation: 'message.direct_send' });
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
      ownerId: userId,
      kind: 'direct',
      contextId: route.params.matchId,
      clientMessageId,
      body: trimmed,
      createdAt,
      attempt: 0,
      nextAttemptAt: createdAt,
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
                  queryKeys.messages.match(route.params.matchId),
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
                queryClient.setQueryData(
                  queryKeys.messages.match(route.params.matchId),
                  {
                    ...match.data,
                    status: 'blocked',
                    blockedByMe: true,
                  },
                );
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
                queryClient.setQueryData(
                  queryKeys.messages.match(route.params.matchId),
                  {
                    ...match.data,
                    status: 'ended',
                    blockedByMe: false,
                  },
                );
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.messages.matches,
      });
      queryClient.removeQueries({
        queryKey: queryKeys.messages.direct(route.params.matchId),
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
              <AppImage uri={primaryPhoto.url} style={styles.headerAvatar} />
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
            <DirectMessageBubble
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
          <ChatComposer
            accessibilityLabel="Özel mesaj yaz"
            value={body}
            onChangeText={value => {
              setBody(value);
              presence.setTyping(Boolean(value.trim()));
            }}
            onBlur={() => presence.setTyping(false)}
            onAddEmoji={() =>
              setBody(current =>
                current.length < contentLimits.message
                  ? `${current}😊`
                  : current,
              )
            }
            onSend={() => void submit()}
          />
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
          <View style={styles.sheet} accessibilityViewIsModal>
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
          <View style={styles.reportSheet} accessibilityViewIsModal>
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

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas },
  header: {
    minHeight: 60,
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
  headerSkeleton: { height: 60 },
  messagesSkeleton: { flex: 1, margin: spacing.md },
  list: { padding: spacing.md },
  locked: {
    minHeight: 60,
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
    width: '100%',
    maxWidth: layout.maxModalWidth,
    maxHeight: '92%',
    alignSelf: 'center',
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

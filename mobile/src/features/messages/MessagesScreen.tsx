import type { MessagesStackParamList } from '@app/navigation/types';
import { useSessionStore } from '@features/auth/sessionStore';
import { useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  RefreshableContent,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { formatMessagePreviewDateTime } from '@shared/lib/date';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, shadows, spacing, typography } from '@shared/theme';
import type { Match } from '@shared/types/domain';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
  type ViewToken,
} from 'react-native';

import { listMatches, subscribeToMatchList } from './messageService';
import { useConversationPresence } from './useConversationPresence';

type Props = NativeStackScreenProps<MessagesStackParamList, 'Messages'>;
type Filter = 'all';

export function MessagesScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const currentUserId = useSessionStore(
    state => state.session?.user.id ?? null,
  );
  const listRef = useRef<FlashListRef<Match>>(null);
  useScrollToTop(listRef);
  const filter: Filter = 'all';
  const [search, setSearch] = useState('');
  const [visibleMatchIds, setVisibleMatchIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const matches = useInfiniteQuery({
    queryKey: ['matches', filter],
    queryFn: ({ pageParam }) => listMatches(filter, pageParam),
    initialPageParam: null as { activityAt: string; matchId: string } | null,
    getNextPageParam: page => page.nextCursor,
  });
  const items = useMemo(() => {
    const allItems = matches.data?.pages.flatMap(page => page.items) ?? [];
    const term = search.trim().toLocaleLowerCase('tr-TR');
    return term
      ? allItems.filter(
          item =>
            item.otherUser.fullName.toLocaleLowerCase('tr-TR').includes(term) ||
            item.eventTitle.toLocaleLowerCase('tr-TR').includes(term),
        )
      : allItems;
  }, [matches.data, search]);
  const newMatches =
    filter === 'all' && !search
      ? items.filter(item => !item.lastMessage && item.status === 'active')
      : [];
  const conversations = newMatches.length
    ? items.filter(item => item.lastMessage || item.status !== 'active')
    : items;
  const refreshMatches = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['matches'] }),
    [queryClient],
  );
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<Match>[] }) => {
      setVisibleMatchIds(
        new Set(
          viewableItems.flatMap(token =>
            token.isViewable && token.item ? [token.item.id] : [],
          ),
        ),
      );
    },
  ).current;

  useEffect(() => {
    if (!currentUserId) return;
    return subscribeToMatchList(currentUserId, refreshMatches);
  }, [currentUserId, refreshMatches]);

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="heading22">Mesajlar</AppText>
          <AppText variant="caption12" tone="secondary">
            Etkinlik eşleşmelerinle özel sohbetler
          </AppText>
        </View>
      </View>
      <View style={styles.search}>
        <Search size={20} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel="Mesajlarda ara"
          placeholder="Mesajlarda ara..."
          placeholderTextColor={colors.textTertiary}
          value={search}
          maxLength={contentLimits.messageSearch}
          onChangeText={setSearch}
          style={styles.searchInput}
        />
      </View>
      {matches.isLoading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
          <Skeleton style={styles.skeleton} />
        </View>
      ) : matches.isError ? (
        <RefreshableContent
          refreshing={matches.isRefetching}
          onRefresh={() => void matches.refetch()}
        >
          <ErrorState
            title="Mesajlar yüklenemedi"
            description={toAppError(matches.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void matches.refetch()}
          />
        </RefreshableContent>
      ) : items.length === 0 ? (
        <RefreshableContent
          refreshing={matches.isRefetching}
          onRefresh={() => void matches.refetch()}
        >
          <StateView
            title={search ? 'Sonuç bulunamadı' : 'Henüz mesajın yok'}
            description={
              search
                ? 'Başka bir kişi veya etkinlik adı dene.'
                : 'Bir etkinliğin eşleşme alanında karşılıklı beğeni olduğunda özel sohbetiniz burada görünür.'
            }
          />
        </RefreshableContent>
      ) : (
        <FlashList
          ref={listRef}
          data={conversations}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            newMatches.length ? (
              <NewMatches
                items={newMatches}
                onOpen={matchId =>
                  navigation.navigate('DirectChat', { matchId })
                }
              />
            ) : null
          }
          renderItem={({ item, index }) => (
            <ConversationRow
              match={item}
              currentUserId={currentUserId}
              presenceEnabled={
                item.status === 'active' &&
                (visibleMatchIds.size === 0
                  ? index < 10
                  : visibleMatchIds.has(item.id))
              }
              onPress={() =>
                navigation.navigate('DirectChat', { matchId: item.id })
              }
            />
          )}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 45 }}
          refreshControl={
            <RefreshControl
              refreshing={matches.isRefetching && !matches.isFetchingNextPage}
              onRefresh={() => void matches.refetch()}
              tintColor={colors.brand}
            />
          }
          onEndReached={() => {
            if (matches.hasNextPage && !matches.isFetchingNextPage)
              void matches.fetchNextPage();
          }}
        />
      )}
    </Screen>
  );
}

function NewMatches({
  items,
  onOpen,
}: {
  items: Match[];
  onOpen: (matchId: string) => void;
}) {
  return (
    <View style={styles.newSection}>
      <AppText variant="label15">Yeni eşleşmeler</AppText>
      <FlashList
        horizontal
        data={items}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.otherUser.fullName} ile sohbeti aç`}
            onPress={() => onOpen(item.id)}
            style={styles.newMatch}
          >
            {item.otherUser.photos[0] ? (
              <Image
                source={{ uri: item.otherUser.photos[0].url }}
                style={styles.newAvatar}
              />
            ) : (
              <View style={styles.newAvatar} />
            )}
            <AppText variant="caption12" numberOfLines={1}>
              {item.otherUser.fullName.split(' ')[0]}
            </AppText>
          </Pressable>
        )}
      />
    </View>
  );
}

function ConversationRow({
  match,
  currentUserId,
  presenceEnabled,
  onPress,
}: {
  match: Match;
  currentUserId: string | null;
  presenceEnabled: boolean;
  onPress: () => void;
}) {
  const photo = match.otherUser.photos[0];
  const presence = useConversationPresence({
    currentUserId,
    otherUserId: match.otherUser.id,
    enabled: presenceEnabled,
    publishTyping: false,
  });
  const statusText =
    match.status === 'ended'
      ? 'Eşleşme sona erdi'
      : match.status === 'blocked'
      ? 'Engellenen sohbet'
      : presence.otherTyping
      ? 'Yazıyor...'
      : match.lastMessage ?? 'Yeni eşleşme · İlk mesajı gönder';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${match.otherUser.fullName} özel sohbetini aç`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        {photo ? (
          <Image source={{ uri: photo.url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar} />
        )}
        {presence.otherOnline ? <View style={styles.avatarOnlineDot} /> : null}
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <View style={styles.nameWrap}>
            <AppText variant="label15" numberOfLines={1} style={styles.name}>
              {match.otherUser.fullName}
            </AppText>
            {presence.otherOnline ? (
              <View style={styles.onlineLabel}>
                <View style={styles.inlineOnlineDot} />
                <AppText variant="tiny11" tone="success">
                  Çevrimiçi
                </AppText>
              </View>
            ) : null}
          </View>
          <AppText variant="tiny11" tone="tertiary">
            {match.lastMessageAt
              ? formatMessagePreviewDateTime(match.lastMessageAt)
              : 'Yeni'}
          </AppText>
        </View>
        <AppText
          variant="body14"
          tone={presence.otherTyping ? 'success' : 'secondary'}
          numberOfLines={1}
          style={presence.otherTyping ? styles.typingPreview : undefined}
        >
          {statusText}
        </AppText>
      </View>
      {match.unreadCount > 0 ? (
        <View style={styles.unread}>
          <AppText variant="caption12" tone="inverse">
            {match.unreadCount > 99 ? '99+' : match.unreadCount}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.canvas },
  header: {
    minHeight: 72,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerText: { gap: 2 },
  search: {
    height: 48,
    margin: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  searchInput: { ...typography.body15, flex: 1, color: colors.textPrimary },
  list: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  skeletons: { padding: spacing.md, gap: spacing.sm },
  skeleton: { height: 96 },
  newSection: { gap: spacing.sm, paddingBottom: spacing.md },
  newMatch: {
    width: 72,
    alignItems: 'center',
    gap: spacing.xs,
    marginRight: spacing.sm,
  },
  newAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.brand,
  },
  row: {
    ...shadows.card,
    minHeight: 78,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  pressed: { opacity: 0.72 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  avatarOnlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.success,
  },
  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  nameWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: { flex: 1 },
  onlineLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  inlineOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  typingPreview: { fontWeight: '600' },
  unread: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

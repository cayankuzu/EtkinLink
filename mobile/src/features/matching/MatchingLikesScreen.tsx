import type { MatchesStackParamList } from '@app/navigation/types';
import { useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  IconButton,
  Screen,
  StateView,
} from '@shared/components';
import { premiumComingSoonMessage } from '@shared/constants/premium';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, shadows, spacing } from '@shared/theme';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Heart, LockKeyhole, Sparkles, X } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  changeLikeToPass,
  getMatchingLikeCounts,
  type LikedCandidate,
  listIncomingLikedCandidates,
  listLikedCandidates,
} from './matchingService';

type Props = NativeStackScreenProps<MatchesStackParamList, 'Matches'>;
type Section = 'outgoing' | 'incoming';

export function MatchingLikesScreen(_props: Props) {
  const queryClient = useQueryClient();
  const outgoingRef = useRef<FlatList<LikedCandidate>>(null);
  const incomingRef = useRef<FlatList<LikedCandidate>>(null);
  useScrollToTop(outgoingRef);
  useScrollToTop(incomingRef);
  const [section, setSection] = useState<Section>('outgoing');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const counts = useQuery({
    queryKey: ['matching-like-counts'],
    queryFn: getMatchingLikeCounts,
    staleTime: 30_000,
  });
  const liked = useInfiniteQuery({
    queryKey: ['liked-candidates'],
    queryFn: ({ pageParam }) => listLikedCandidates(pageParam),
    initialPageParam: null as { likedAt: string; userId: string } | null,
    getNextPageParam: page => page.nextCursor,
    staleTime: 30_000,
  });
  const incomingLiked = useInfiniteQuery({
    queryKey: ['incoming-liked-candidates'],
    queryFn: ({ pageParam }) => listIncomingLikedCandidates(pageParam),
    initialPageParam: null as { likedAt: string; userId: string } | null,
    getNextPageParam: page => page.nextCursor,
    enabled: section === 'incoming',
    staleTime: 30_000,
  });
  const items = useMemo(
    () =>
      (liked.data?.pages.flatMap(page => page.items) ?? []).filter(
        item => !hiddenIds.has(item.candidate.id),
      ),
    [hiddenIds, liked.data],
  );
  const incomingItems = useMemo(
    () => incomingLiked.data?.pages.flatMap(page => page.items) ?? [],
    [incomingLiked.data],
  );
  const changeReaction = useMutation({
    mutationFn: (item: LikedCandidate) =>
      changeLikeToPass(item.eventId, item.candidate.id),
    onMutate: item => {
      setHiddenIds(value => new Set(value).add(item.candidate.id));
    },
    onSuccess: quota => {
      queryClient.setQueryData(['swipe-quota'], quota);
      void queryClient.invalidateQueries({
        queryKey: ['matching-like-counts'],
      });
      void queryClient.invalidateQueries({ queryKey: ['liked-candidates'] });
      void queryClient.invalidateQueries({
        queryKey: ['candidates'],
        refetchType: 'inactive',
      });
    },
    onError: (_error, item) => {
      setHiddenIds(value => {
        const next = new Set(value);
        next.delete(item.candidate.id);
        return next;
      });
    },
  });

  async function refresh() {
    await Promise.all([
      counts.refetch(),
      liked.refetch(),
      incomingLiked.refetch(),
    ]);
    setHiddenIds(new Set());
  }

  if (counts.isError || liked.isError || incomingLiked.isError) {
    return (
      <Screen>
        <ErrorState
          title="Eşleşme listesi yüklenemedi"
          description={
            toAppError(counts.error ?? liked.error ?? incomingLiked.error)
              .message
          }
          actionLabel="Tekrar dene"
          onAction={() => void refresh()}
        />
      </Screen>
    );
  }

  const incomingCount = counts.data?.incomingCount ?? 0;
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Heart size={22} color={colors.brand} fill={colors.brandSoft} />
        </View>
        <View style={styles.headerText}>
          <AppText variant="heading22">Eşleşme</AppText>
          <AppText variant="caption12" tone="secondary">
            Beğenilerini ve sana gelen ilgiyi yönet
          </AppText>
        </View>
      </View>
      <View style={styles.tabs}>
        <SectionButton
          selected={section === 'outgoing'}
          label={`Beğendiklerim (${counts.data?.outgoingCount ?? 0})`}
          onPress={() => setSection('outgoing')}
        />
        <SectionButton
          selected={section === 'incoming'}
          label={`Beni beğenenler (${incomingCount})`}
          onPress={() => setSection('incoming')}
        />
      </View>

      {section === 'outgoing' ? (
        <FlatList
          ref={outgoingRef}
          key="outgoing-list"
          data={items}
          keyExtractor={item => item.candidate.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={liked.isRefetching || counts.isRefetching}
              onRefresh={() => void refresh()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          renderItem={({ item }) => (
            <LikedProfileCard
              item={item}
              removing={
                changeReaction.isPending &&
                changeReaction.variables?.candidate.id === item.candidate.id
              }
              onRemove={() => changeReaction.mutate(item)}
            />
          )}
          onEndReached={() => {
            if (liked.hasNextPage && !liked.isFetchingNextPage)
              void liked.fetchNextPage();
          }}
          onEndReachedThreshold={0.45}
          ListEmptyComponent={
            liked.isLoading ? (
              <LoadingRows />
            ) : (
              <StateView
                title="Henüz birini beğenmedin"
                description="Etkinlik odalarındaki eşleşme alanından beğendiğin kişiler burada görünür."
              />
            )
          }
        />
      ) : (
        <FlatList
          ref={incomingRef}
          data={incomingItems}
          key="incoming-grid"
          keyExtractor={item => `${item.eventId}:${item.candidate.id}`}
          numColumns={2}
          columnWrapperStyle={
            incomingItems.length > 1 ? styles.lockedRow : undefined
          }
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={counts.isRefetching || incomingLiked.isRefetching}
              onRefresh={() => void refresh()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          ListHeaderComponent={<PremiumLock />}
          renderItem={({ item }) => <LockedProfile item={item} />}
          onEndReached={() => {
            if (incomingLiked.hasNextPage && !incomingLiked.isFetchingNextPage)
              void incomingLiked.fetchNextPage();
          }}
          onEndReachedThreshold={0.45}
          ListEmptyComponent={
            counts.isLoading || incomingLiked.isLoading ? (
              <LoadingRows />
            ) : (
              <StateView
                title="Henüz yeni beğeni yok"
                description="Seni beğenen kişiler olduğunda sayı burada güncellenir."
              />
            )
          }
        />
      )}
    </Screen>
  );
}

function SectionButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <AppText
        variant="caption12"
        tone={selected ? 'brand' : 'secondary'}
        align="center"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function LikedProfileCard({
  item,
  removing,
  onRemove,
}: {
  item: LikedCandidate;
  removing: boolean;
  onRemove: () => void;
}) {
  const profile = item.candidate;
  const translateX = useSharedValue(0);
  const canRemove = !item.matched && !removing;
  const swipe = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-16, 16])
    .onUpdate(event => {
      translateX.value = Math.min(0, event.translationX);
    })
    .onEnd(event => {
      if (canRemove && event.translationX <= -96) {
        translateX.value = withTiming(-420, { duration: 210 }, finished => {
          if (finished) scheduleOnRN(onRemove);
        });
        return;
      }
      translateX.value = withSpring(0, { damping: 18, stiffness: 190 });
    });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={styles.swipeShell}>
      <View style={styles.swipeHint}>
        <X size={19} color={colors.textInverse} />
        <AppText variant="caption12" tone="inverse">
          Geç
        </AppText>
      </View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.profileCard, animatedStyle]}>
          {profile.photos[0]?.url ? (
            <Image
              source={{ uri: profile.photos[0].url }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatar} />
          )}
          <View style={styles.profileInfo}>
            <View style={styles.nameRow}>
              <AppText variant="label15" numberOfLines={1} style={styles.name}>
                {profile.fullName}
                {profile.age !== null ? `, ${profile.age}` : ''}
              </AppText>
              {profile.compatibility ? (
                <View style={styles.scoreBadge}>
                  <Sparkles size={12} color={colors.brand} />
                  <AppText variant="tiny11" tone="brand">
                    %{profile.compatibility.score}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="caption12" tone="secondary" numberOfLines={1}>
              @{profile.username} · {profile.city}
            </AppText>
            <AppText variant="caption12" tone="secondary" numberOfLines={1}>
              {item.eventTitle}
            </AppText>
            {item.matched ? (
              <AppText variant="caption12" tone="success">
                Eşleştiniz · sohbet Mesajlar alanında
              </AppText>
            ) : (
              <AppText variant="tiny11" tone="tertiary">
                {new Date(item.likedAt).toLocaleDateString('tr-TR')}
              </AppText>
            )}
          </View>
          <IconButton
            icon={X}
            label={item.matched ? 'Aktif eşleşme' : 'Beğeniyi kaldır ve geç'}
            danger
            disabled={!canRemove}
            onPress={onRemove}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function PremiumLock() {
  return (
    <View style={styles.premiumCard}>
      <View style={styles.lockIcon}>
        <LockKeyhole size={22} color={colors.brand} />
      </View>
      <View style={styles.premiumText}>
        <AppText variant="label15">Seni beğenenler gizli</AppText>
        <AppText variant="caption12" tone="secondary">
          {premiumComingSoonMessage}
        </AppText>
      </View>
    </View>
  );
}

function LockedProfile({ item }: { item: LikedCandidate }) {
  const photoUrl = item.candidate.photos[0]?.url;
  return (
    <View style={styles.lockedCard} accessibilityLabel="Gizli beğenen profili">
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.lockedImage}
          blurRadius={24}
        />
      ) : (
        <Image
          source={require('../../assets/images/etkinlink-symbol.png')}
          style={styles.lockedImage}
          blurRadius={18}
        />
      )}
      <View style={styles.lockedContent}>
        <View style={styles.lockedLineWide} />
        <View style={styles.lockedLine} />
        <View style={styles.lockedPills}>
          <View style={styles.lockedPill} />
          <View style={styles.lockedPill} />
        </View>
      </View>
      <View style={styles.lockedOverlay} pointerEvents="none">
        <View style={styles.lockedBadge}>
          <LockKeyhole size={18} color={colors.textInverse} />
          <AppText variant="tiny11" tone="inverse">
            Premium
          </AppText>
        </View>
      </View>
    </View>
  );
}

function LoadingRows() {
  return (
    <View style={styles.loadingRows}>
      <View style={styles.loadingRow} />
      <View style={styles.loadingRow} />
      <View style={styles.loadingRow} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.md },
  header: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  headerText: { flex: 1, gap: 2 },
  tabs: {
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  tabSelected: { backgroundColor: colors.surface, ...shadows.card },
  list: { flexGrow: 1, gap: spacing.sm, paddingVertical: spacing.md },
  profileCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    ...shadows.card,
  },
  swipeShell: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.danger,
  },
  swipeHint: {
    position: 'absolute',
    top: 0,
    right: spacing.lg,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  avatar: {
    width: 80,
    height: 88,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  profileInfo: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flexShrink: 1 },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.brandSubtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  lockIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  premiumText: { flex: 1, gap: 3 },
  lockedRow: { gap: spacing.sm },
  lockedCard: {
    flex: 1,
    aspectRatio: 0.78,
    maxWidth: '49%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  lockedImage: { width: '100%', height: '100%', opacity: 0.52 },
  lockedContent: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    left: spacing.sm,
    gap: 6,
  },
  lockedLineWide: {
    width: '76%',
    height: 10,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.68)',
  },
  lockedLine: {
    width: '54%',
    height: 8,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.52)',
  },
  lockedPills: { flexDirection: 'row', gap: 5 },
  lockedPill: {
    width: 36,
    height: 14,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  lockedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.28)',
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(16, 24, 40, 0.54)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  loadingRows: { gap: spacing.sm },
  loadingRow: {
    height: 112,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
});

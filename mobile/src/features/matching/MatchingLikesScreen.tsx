import type { MatchesStackParamList } from '@app/navigation/types';
import { useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppImage,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { getGenderLabel } from '@shared/lib/profileLabels';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, radius, shadows, spacing } from '@shared/theme';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  CalendarDays,
  Heart,
  MapPin,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';

import { CandidateCard } from './CandidateCard';
import {
  restorePendingLikes,
  suppressCandidateFromPendingLikes,
} from './matchingQueryCache';
import {
  changeLikeToPass,
  getMatchingLikeCounts,
  type LikedCandidate,
  listIncomingLikedCandidates,
  listLikedCandidates,
  swipeCandidate,
} from './matchingService';

type Props = NativeStackScreenProps<MatchesStackParamList, 'Matches'>;
type Section = 'outgoing' | 'incoming';
type SelectedProfile = { item: LikedCandidate; source: Section };

export function MatchingLikesScreen({ route }: Props) {
  const queryClient = useQueryClient();
  const outgoingRef = useRef<FlatList<LikedCandidate>>(null);
  const incomingRef = useRef<FlatList<LikedCandidate>>(null);
  useScrollToTop(outgoingRef);
  useScrollToTop(incomingRef);
  const [section, setSection] = useState<Section>(
    route.params?.section ?? 'outgoing',
  );
  const [selectedProfile, setSelectedProfile] =
    useState<SelectedProfile | null>(null);
  const counts = useQuery({
    queryKey: queryKeys.matching.likeCounts,
    queryFn: ({ signal }) => getMatchingLikeCounts(signal),
    staleTime: 30_000,
  });
  const liked = useInfiniteQuery({
    queryKey: queryKeys.matching.liked,
    queryFn: ({ pageParam, signal }) => listLikedCandidates(pageParam, signal),
    initialPageParam: null as { likedAt: string; userId: string } | null,
    getNextPageParam: page => page.nextCursor,
    staleTime: 30_000,
  });
  const incomingLiked = useInfiniteQuery({
    queryKey: queryKeys.matching.incomingLiked,
    queryFn: ({ pageParam, signal }) =>
      listIncomingLikedCandidates(pageParam, signal),
    initialPageParam: null as { likedAt: string; userId: string } | null,
    getNextPageParam: page => page.nextCursor,
    enabled: section === 'incoming',
    staleTime: 30_000,
  });
  const items = useMemo(
    () => liked.data?.pages.flatMap(page => page.items) ?? [],
    [liked.data],
  );
  const incomingItems = useMemo(
    () => incomingLiked.data?.pages.flatMap(page => page.items) ?? [],
    [incomingLiked.data],
  );
  const changeReaction = useMutation({
    mutationFn: (item: LikedCandidate) =>
      changeLikeToPass(item.eventId, item.candidate.id),
    onMutate: item => {
      setSelectedProfile(null);
      return suppressCandidateFromPendingLikes(queryClient, item.candidate.id);
    },
    onSuccess: quota => {
      queryClient.setQueryData(queryKeys.matching.swipeQuota, quota);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.likeCounts,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.liked,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.incomingLiked,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.candidates(),
        refetchType: 'inactive',
      });
    },
    onError: (error, _item, snapshot) => {
      if (snapshot) restorePendingLikes(queryClient, snapshot);
      Alert.alert('İşlem tamamlanamadı', toAppError(error).message);
    },
  });
  const rejectIncoming = useMutation({
    mutationFn: (item: LikedCandidate) =>
      swipeCandidate(item.eventId, item.candidate.id, 'pass'),
    onMutate: item => {
      setSelectedProfile(null);
      return suppressCandidateFromPendingLikes(queryClient, item.candidate.id);
    },
    onSuccess: result => {
      queryClient.setQueryData(queryKeys.matching.swipeQuota, result.quota);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.likeCounts,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.liked,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.incomingLiked,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.candidates(),
        refetchType: 'inactive',
      });
    },
    onError: (error, _item, snapshot) => {
      if (snapshot) restorePendingLikes(queryClient, snapshot);
      Alert.alert('Profil geçilemedi', toAppError(error).message);
    },
  });

  async function refresh() {
    await Promise.all([
      counts.refetch(),
      liked.refetch(),
      incomingLiked.refetch(),
    ]);
  }

  if (counts.isError || liked.isError || incomingLiked.isError) {
    return (
      <Screen testID="matching-screen">
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
    <Screen contentStyle={styles.screen} testID="matching-screen">
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
          key="outgoing-grid"
          style={styles.results}
          data={items}
          keyExtractor={item => `${item.eventId}:${item.candidate.id}`}
          numColumns={2}
          columnWrapperStyle={items.length > 1 ? styles.profileRow : undefined}
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
              onOpen={() => setSelectedProfile({ item, source: 'outgoing' })}
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
          style={styles.results}
          keyExtractor={item => `${item.eventId}:${item.candidate.id}`}
          numColumns={2}
          columnWrapperStyle={
            incomingItems.length > 1 ? styles.profileRow : undefined
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
          renderItem={({ item }) => (
            <LikedProfileCard
              item={item}
              removing={
                rejectIncoming.isPending &&
                rejectIncoming.variables?.candidate.id === item.candidate.id
              }
              showRemoveAction={false}
              onOpen={() => setSelectedProfile({ item, source: 'incoming' })}
            />
          )}
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
      <Modal
        visible={Boolean(selectedProfile)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setSelectedProfile(null)}
      >
        <Screen contentStyle={styles.detailScreen}>
          <View style={styles.detailHeader}>
            <View style={styles.detailHeading}>
              <AppText variant="label15">
                {selectedProfile?.source === 'incoming'
                  ? 'Gelen beğeniyi değerlendir'
                  : 'Profil detayları'}
              </AppText>
              <AppText variant="tiny11" tone="secondary" numberOfLines={1}>
                {selectedProfile?.item.eventTitle ?? 'Etkinlik'}
              </AppText>
            </View>
            <IconButton
              icon={X}
              label="Profil detaylarını kapat"
              onPress={() => setSelectedProfile(null)}
            />
          </View>
          {selectedProfile ? (
            selectedProfile.source === 'incoming' ? (
              <View style={styles.detailCard}>
                <CandidateCard
                  candidate={selectedProfile.item.candidate}
                  eventTitle={selectedProfile.item.eventTitle}
                  showLikeAction={false}
                  disabled={rejectIncoming.isPending}
                  onPass={() => rejectIncoming.mutate(selectedProfile.item)}
                />
              </View>
            ) : (
              <>
                <View style={styles.detailCard}>
                  <CandidateCard
                    candidate={selectedProfile.item.candidate}
                    eventTitle={selectedProfile.item.eventTitle}
                    showActions={false}
                  />
                </View>
                <AppButton
                  label="Beğeniyi kaldır ve geç"
                  variant="danger"
                  icon={X}
                  loading={changeReaction.isPending}
                  onPress={async () => {
                    await changeReaction.mutateAsync(selectedProfile.item);
                  }}
                />
              </>
            )
          ) : null}
        </Screen>
      </Modal>
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
  showRemoveAction = true,
  onOpen,
  onRemove,
}: {
  item: LikedCandidate;
  removing: boolean;
  showRemoveAction?: boolean;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const profile = item.candidate;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${profile.fullName} profilini aç`}
      accessibilityHint="Profil fotoğraflarını ve ayrıntılarını gösterir"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.profileCard,
        pressed && styles.profileCardPressed,
      ]}
    >
      <View style={styles.profileVisual}>
        {profile.photos[0]?.url ? (
          <AppImage
            uri={profile.photos[0].url}
            style={styles.profileImage}
            highPriority
            accessibilityLabel={`${profile.fullName} profil fotoğrafı`}
          />
        ) : (
          <Image
            source={require('../../assets/images/etkinlink-symbol.png')}
            style={styles.profilePlaceholder}
          />
        )}
        {profile.compatibility ? (
          <View style={styles.scoreBadge}>
            <Sparkles size={12} color={colors.brand} />
            <AppText variant="tiny11" tone="brand">
              %{profile.compatibility.score}
            </AppText>
          </View>
        ) : null}
        {showRemoveAction && onRemove ? (
          <IconButton
            icon={X}
            label="Beğeniyi kaldır ve geç"
            danger
            disabled={removing}
            onPress={event => {
              event.stopPropagation();
              onRemove();
            }}
            style={styles.removeButton}
          />
        ) : null}
      </View>
      <View style={styles.profileInfo}>
        <AppText variant="label15" numberOfLines={1}>
          {profile.fullName}
          {profile.age !== null ? `, ${profile.age}` : ''}
        </AppText>
        <AppText variant="caption12" tone="secondary" numberOfLines={1}>
          @{profile.username}
        </AppText>
        <View style={styles.profileMeta}>
          <UserRound size={13} color={colors.textSecondary} />
          <AppText variant="tiny11" tone="secondary" numberOfLines={1}>
            {getGenderLabel(profile.gender)}
          </AppText>
        </View>
        <View style={styles.profileMeta}>
          <MapPin size={13} color={colors.textSecondary} />
          <AppText variant="tiny11" tone="secondary" numberOfLines={1}>
            {profile.city || 'Konum gizli'}
          </AppText>
        </View>
        <View style={styles.eventMeta}>
          <CalendarDays size={12} color={colors.brand} />
          <AppText variant="tiny11" tone="brand" numberOfLines={1}>
            {item.eventTitle}
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

function LoadingRows() {
  return (
    <View style={styles.loadingRows}>
      {Array.from({ length: 4 }, (_, index) => (
        <View key={index} style={styles.loadingRow} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.md },
  header: {
    minHeight: 60,
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
  results: { flex: 1 },
  list: { flexGrow: 1, gap: spacing.sm, paddingVertical: spacing.md },
  profileRow: { gap: spacing.sm },
  profileCard: {
    flex: 1,
    maxWidth: '49%',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.card,
  },
  profileCardPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  profileVisual: {
    width: '100%',
    aspectRatio: 0.86,
    backgroundColor: colors.surfaceMuted,
  },
  profileImage: { width: '100%', height: '100%' },
  profilePlaceholder: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    tintColor: colors.brand,
  },
  removeButton: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 40,
    height: 40,
    backgroundColor: colors.glassSurface,
    borderColor: colors.glassBorderStrong,
    ...shadows.floating,
  },
  profileInfo: { gap: 3, padding: spacing.sm },
  profileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xxs,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  scoreBadge: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.full,
    backgroundColor: colors.glassSurface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 5,
    ...shadows.card,
  },
  detailScreen: { padding: spacing.md, gap: spacing.sm },
  detailHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailHeading: { flex: 1, gap: 2 },
  detailCard: { flex: 1, minHeight: 0 },
  loadingRows: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  loadingRow: {
    width: '48%',
    aspectRatio: 0.62,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
});

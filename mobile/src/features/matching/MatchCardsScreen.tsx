import type {
  MainTabParamList,
  RoomsStackParamList,
} from '@app/navigation/types';
import { getEvent } from '@features/events/eventService';
import { reportProfilePhoto } from '@features/profile/profileService';
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
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type { Candidate } from '@shared/types/domain';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Heart,
  MessageCircle,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CandidateCard } from './CandidateCard';
import type { CandidateCursor } from './matchingService';
import {
  getSwipeQuota,
  listCandidates,
  subscribeToCandidateChanges,
  swipeCandidate,
} from './matchingService';
import { SwipeQuotaBar } from './SwipeQuotaBar';

type Props = NativeStackScreenProps<RoomsStackParamList, 'MatchCards'>;
type SwipeAction = 'like' | 'pass';

const swipeThreshold = 110;

export function MatchCardsScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [match, setMatch] = useState<{
    candidate: Candidate;
    matchId: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const swipePending = useRef(false);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const event = useQuery({
    queryKey: ['event', route.params.eventId],
    queryFn: () => getEvent(route.params.eventId),
  });
  const candidates = useInfiniteQuery({
    queryKey: ['candidates', route.params.eventId],
    queryFn: ({ pageParam }) => listCandidates(route.params.eventId, pageParam),
    initialPageParam: null as CandidateCursor | null,
    getNextPageParam: page => page.nextCursor,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = candidates;
  const quota = useQuery({
    queryKey: ['swipe-quota'],
    queryFn: getSwipeQuota,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const items = useMemo(
    () => candidates.data?.pages.flatMap(page => page.items) ?? [],
    [candidates.data],
  );
  const current = items[index];
  const next = items[index + 1];

  const refreshDeck = useCallback(async () => {
    setIndex(0);
    setActionError(null);
    translateX.value = 0;
    translateY.value = 0;
    await Promise.all([
      queryClient.resetQueries({
        queryKey: ['candidates', route.params.eventId],
        exact: true,
      }),
      queryClient.invalidateQueries({
        queryKey: ['swipe-quota'],
        exact: true,
      }),
    ]);
  }, [queryClient, route.params.eventId, translateX, translateY]);

  useFocusEffect(
    useCallback(() => {
      void refreshDeck();
      return subscribeToCandidateChanges(route.params.eventId, () => {
        void refreshDeck();
      });
    }, [refreshDeck, route.params.eventId]),
  );

  useEffect(() => {
    if (items.length - index <= 5 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, index, isFetchingNextPage, items.length]);

  const reportPhoto = useCallback(
    async (candidate: Candidate) => {
      try {
        await reportProfilePhoto(candidate.id, route.params.eventId);
        Alert.alert(
          'Şikayet alındı',
          'Bildirimin inceleme ekibine gönderildi.',
        );
      } catch (error) {
        Alert.alert('Şikayet gönderilemedi', toAppError(error).message);
      }
    },
    [route.params.eventId],
  );

  const action = useMutation({
    mutationFn: ({
      candidate,
      kind,
    }: {
      candidate: Candidate;
      kind: SwipeAction;
    }) => swipeCandidate(route.params.eventId, candidate.id, kind),
    onMutate: variables => {
      const previousQuota = queryClient.getQueryData<
        Awaited<ReturnType<typeof getSwipeQuota>>
      >(['swipe-quota']);
      if (previousQuota) {
        queryClient.setQueryData(['swipe-quota'], {
          ...previousQuota,
          usedLikes:
            previousQuota.usedLikes + (variables.kind === 'like' ? 1 : 0),
          usedPasses:
            previousQuota.usedPasses + (variables.kind === 'pass' ? 1 : 0),
          remainingLikes:
            previousQuota.remainingLikes - (variables.kind === 'like' ? 1 : 0),
          remainingPasses:
            previousQuota.remainingPasses - (variables.kind === 'pass' ? 1 : 0),
        });
      }
      return { previousQuota };
    },
    onSuccess: (result, variables) => {
      swipePending.current = false;
      queryClient.setQueryData(['swipe-quota'], result.quota);
      void queryClient.invalidateQueries({
        queryKey: ['matching-like-counts'],
      });
      void queryClient.invalidateQueries({ queryKey: ['liked-candidates'] });
      if (variables.kind === 'like') {
        void queryClient.invalidateQueries({
          queryKey: ['candidates'],
          refetchType: 'inactive',
        });
      }
      if (result.matched && result.matchId) {
        setMatch({ candidate: variables.candidate, matchId: result.matchId });
      }
    },
    onError: (error, _variables, context) => {
      swipePending.current = false;
      if (context?.previousQuota)
        queryClient.setQueryData(['swipe-quota'], context.previousQuota);
      setIndex(value => Math.max(value - 1, 0));
      setActionError(toAppError(error).message);
    },
  });

  const finishSwipe = useCallback(
    (kind: SwipeAction) => {
      if (!current || action.isPending || swipePending.current) return;
      const remaining =
        kind === 'like'
          ? quota.data?.remainingLikes
          : quota.data?.remainingPasses;
      if (remaining === undefined || remaining <= 0) {
        setActionError(
          kind === 'like'
            ? 'Beğeni hakkın yenilenene kadar beklemelisin.'
            : 'Geçme hakkın yenilenene kadar beklemelisin.',
        );
        return;
      }
      swipePending.current = true;
      setActionError(null);
      action.mutate({ candidate: current, kind });
      setIndex(value => value + 1);
      translateX.value = 0;
      translateY.value = 0;
    },
    [action, current, quota.data, translateX, translateY],
  );

  const animateSwipe = useCallback(
    (kind: SwipeAction) => {
      if (!current || action.isPending) return;
      if (reduceMotion) {
        finishSwipe(kind);
        return;
      }
      translateX.value = withTiming(
        kind === 'like' ? width * 1.25 : -width * 1.25,
        { duration: 220 },
        finished => {
          if (finished) scheduleOnRN(finishSwipe, kind);
        },
      );
    },
    [action.isPending, current, finishSwipe, reduceMotion, translateX, width],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-22, 22])
    .onUpdate(eventValue => {
      translateX.value = eventValue.translationX;
      translateY.value = eventValue.translationY * 0.18;
    })
    .onEnd(eventValue => {
      if (Math.abs(eventValue.translationX) >= swipeThreshold) {
        const kind: SwipeAction = eventValue.translationX > 0 ? 'like' : 'pass';
        if (reduceMotion) {
          scheduleOnRN(finishSwipe, kind);
          return;
        }
        translateX.value = withTiming(
          kind === 'like' ? width * 1.25 : -width * 1.25,
          { duration: 200 },
          finished => {
            if (finished) scheduleOnRN(finishSwipe, kind);
          },
        );
        return;
      }
      translateX.value = withSpring(0, { damping: 18, stiffness: 190 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 190 });
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-width, 0, width],
          reduceMotion ? [0, 0, 0] : [-9, 0, 9],
        )}deg`,
      },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [20, swipeThreshold],
      [0, 1],
      'clamp',
    ),
  }));
  const passStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-swipeThreshold, -20],
      [1, 0],
      'clamp',
    ),
  }));

  if (candidates.isLoading || event.isLoading || quota.isLoading) {
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.loadingCard} />
      </Screen>
    );
  }
  if (candidates.isError || event.isError || quota.isError) {
    return (
      <Screen>
        <ErrorState
          title="Adaylar yüklenemedi"
          description={
            toAppError(candidates.error ?? event.error ?? quota.error).message
          }
          actionLabel="Tekrar dene"
          onAction={() => void candidates.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <View style={styles.heading}>
          <AppText variant="label15">Eşleşme</AppText>
        </View>
        <View style={styles.headerActions}>
          <IconButton
            icon={RefreshCw}
            label="Eşleşme kartlarını yenile"
            disabled={candidates.isRefetching}
            onPress={() => void refreshDeck()}
          />
          <IconButton
            icon={SlidersHorizontal}
            label="Eşleşme filtreleri"
            onPress={() =>
              navigation.navigate('MatchFilters', {
                eventId: route.params.eventId,
              })
            }
          />
        </View>
      </View>
      {quota.data ? <SwipeQuotaBar quota={quota.data} /> : null}
      <View style={styles.deck}>
        {next ? (
          <View pointerEvents="none" style={styles.nextCard}>
            <CandidateCard
              candidate={next}
              eventTitle={event.data?.title ?? 'Etkinlik'}
              showActions={false}
              onReportPhoto={() => reportPhoto(next)}
            />
          </View>
        ) : null}
        {current ? (
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.card, cardStyle]}>
              <Animated.View
                pointerEvents="none"
                style={[styles.decision, styles.likeDecision, likeStyle]}
              >
                <AppText variant="heading20" tone="success">
                  BEĞEN
                </AppText>
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[styles.decision, styles.passDecision, passStyle]}
              >
                <AppText variant="heading20" tone="danger">
                  GEÇ
                </AppText>
              </Animated.View>
              <CandidateCard
                candidate={current}
                eventTitle={event.data?.title ?? 'Etkinlik'}
                disabled={action.isPending}
                onPass={() => animateSwipe('pass')}
                onLike={() => animateSwipe('like')}
                onOpenEvent={() =>
                  navigation.navigate('EventDetail', {
                    eventId: route.params.eventId,
                  })
                }
                onReportPhoto={() => reportPhoto(current)}
              />
            </Animated.View>
          </GestureDetector>
        ) : candidates.isFetchingNextPage ? (
          <Skeleton style={styles.loadingCard} />
        ) : (
          <StateView
            title="Şimdilik bu kadar"
            description="Bu etkinlikte eşleşmeyi açan yeni katılımcılar olduğunda burada görünecek."
            actionLabel="Odaya dön"
            onAction={navigation.goBack}
          />
        )}
      </View>
      {actionError ? (
        <AppText
          variant="caption12"
          tone="danger"
          accessibilityRole="alert"
          align="center"
        >
          {actionError}
        </AppText>
      ) : null}
      <Modal
        visible={Boolean(match)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setMatch(null)}
      >
        <View style={styles.modalBackdrop} accessibilityViewIsModal>
          <View pointerEvents="none" style={styles.modalGlowTop} />
          <View pointerEvents="none" style={styles.modalGlowBottom} />
          <View style={styles.modalCard}>
            <View style={styles.matchVisual}>
              <View style={styles.avatarHalo}>
                {match?.candidate.photos[0]?.url ? (
                  <Image
                    source={{ uri: match.candidate.photos[0].url }}
                    style={styles.matchAvatar}
                    accessibilityLabel={`${match.candidate.fullName} profil fotoğrafı`}
                  />
                ) : (
                  <Image
                    source={require('../../assets/images/etkinlink-symbol.png')}
                    style={[styles.matchAvatar, styles.matchAvatarPlaceholder]}
                    accessibilityLabel="EtkinLink profil simgesi"
                  />
                )}
              </View>
              <View style={styles.matchHeart}>
                <Heart
                  size={23}
                  color={colors.textInverse}
                  fill={colors.textInverse}
                />
              </View>
            </View>

            <View style={styles.matchCopy}>
              <View style={styles.matchEyebrow}>
                <Sparkles size={14} color={colors.brand} />
                <AppText variant="tiny11" tone="brand">
                  YENİ EŞLEŞME
                </AppText>
              </View>
              <AppText variant="heading24" align="center">
                Eşleştiniz!
              </AppText>
              <AppText tone="secondary" align="center">
                Sen ve {match?.candidate.fullName} birbirinizi beğendiniz.
                Sohbetiniz hazır; ilk mesajı şimdi gönderebilirsin.
              </AppText>
            </View>

            <View style={styles.matchEvent}>
              <CalendarDays size={16} color={colors.brand} />
              <AppText
                variant="caption12"
                tone="brand"
                numberOfLines={1}
                style={styles.matchEventTitle}
              >
                {event.data?.title ?? 'Etkinlik'}
              </AppText>
            </View>

            <View style={styles.matchActions}>
              <AppButton
                label="Mesaj gönder"
                icon={MessageCircle}
                onPress={() => {
                  setMatch(null);
                  if (!match) return;
                  navigation
                    .getParent<BottomTabNavigationProp<MainTabParamList>>()
                    ?.navigate('MessagesTab', {
                      screen: 'DirectChat',
                      params: { matchId: match.matchId },
                    });
                }}
              />
              <AppButton
                label="Kartlara devam et"
                variant="ghost"
                onPress={() => setMatch(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.sm },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heading: { flex: 1, alignItems: 'center' },
  headerActions: { flexDirection: 'row', gap: spacing.xs },
  deck: { flex: 1, justifyContent: 'center' },
  card: { flex: 1, minHeight: 0, width: '100%', zIndex: 2 },
  nextCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    opacity: 0.58,
    transform: [{ scale: 0.96 }],
  },
  loadingCard: { flex: 1, marginVertical: spacing.md },
  decision: {
    position: 'absolute',
    top: 58,
    zIndex: 4,
    borderWidth: 3,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  likeDecision: {
    left: spacing.lg,
    borderColor: colors.success,
    transform: [{ rotate: '-8deg' }],
  },
  passDecision: {
    right: spacing.lg,
    borderColor: colors.danger,
    transform: [{ rotate: '8deg' }],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    overflow: 'hidden',
  },
  modalGlowTop: {
    position: 'absolute',
    top: '8%',
    right: -90,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(91, 75, 255, 0.26)',
  },
  modalGlowBottom: {
    position: 'absolute',
    bottom: '5%',
    left: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255, 107, 94, 0.18)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.lg,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    ...shadows.match,
  },
  matchVisual: {
    width: 116,
    height: 116,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarHalo: {
    width: 108,
    height: 108,
    borderRadius: 54,
    padding: 5,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  matchAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 49,
    backgroundColor: colors.surfaceMuted,
  },
  matchAvatarPlaceholder: {
    resizeMode: 'contain',
    tintColor: colors.brand,
  },
  matchHeart: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadows.floating,
  },
  matchCopy: { alignItems: 'center', gap: spacing.xs },
  matchEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.xxs,
  },
  matchEvent: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  matchEventTitle: { flexShrink: 1 },
  matchActions: { alignSelf: 'stretch', gap: spacing.xs },
});

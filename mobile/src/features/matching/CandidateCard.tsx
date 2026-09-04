import { ProfilePhotoGallery } from '@features/profile/ProfilePhotoGallery';
import { AppText, IconButton } from '@shared/components';
import { getGenderLabel } from '@shared/lib/profileLabels';
import { colors, radius, shadows, spacing, touchSlopFor } from '@shared/theme';
import type { Candidate } from '@shared/types/domain';
import { CalendarDays, Heart, MapPin, UserRound, X } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { CompatibilityCard } from './CompatibilityCard';

type Props = {
  candidate: Candidate;
  eventTitle: string;
  showActions?: boolean;
  showLikeAction?: boolean;
  onPass?: () => void;
  onLike?: () => void;
  onOpenEvent?: () => void;
  onReportPhoto?: () => void | Promise<void>;
  disabled?: boolean;
};

export function CandidateCard({
  candidate,
  eventTitle,
  showActions = true,
  showLikeAction = true,
  onPass,
  onLike,
  onOpenEvent,
  onReportPhoto,
  disabled = false,
}: Props) {
  return (
    <View style={styles.card}>
      <ScrollView
        nestedScrollEnabled
        directionalLockEnabled
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${eventTitle} etkinliğini aç`}
          onPress={onOpenEvent}
          disabled={!onOpenEvent}
          hitSlop={touchSlopFor(styles.eventContext.height)}
          style={styles.eventContext}
        >
          <CalendarDays size={18} color={colors.textInverse} />
          <AppText
            variant="caption"
            tone="inverse"
            numberOfLines={1}
            style={styles.eventTitle}
          >
            {eventTitle}
          </AppText>
        </Pressable>
        <ProfilePhotoGallery
          photos={candidate.photos}
          accessibilityName={candidate.fullName}
          navigationMode="buttons"
          allowFullscreen={false}
          onReport={onReportPhoto}
          style={styles.gallery}
        />
        <View style={styles.info}>
          <AppText variant="headingMd">
            {candidate.fullName}
            {candidate.age !== null ? `, ${candidate.age}` : ''}
          </AppText>
          <AppText variant="body" tone="secondary">
            @{candidate.username}
          </AppText>
          <View style={styles.metaRow}>
            <MapPin size={16} color={colors.textSecondary} />
            <AppText variant="body" tone="secondary">
              {candidate.city || 'Şehir belirtilmemiş'}
            </AppText>
          </View>
          {candidate.gender ? (
            <View style={styles.metaRow}>
              <UserRound size={16} color={colors.textSecondary} />
              <AppText variant="body" tone="secondary">
                {getGenderLabel(candidate.gender)}
              </AppText>
            </View>
          ) : null}
          {candidate.bio ? (
            <AppText variant="body">{candidate.bio}</AppText>
          ) : null}
          <View style={styles.interests}>
            {candidate.interests.map(interest => (
              <View key={interest.id} style={styles.interest}>
                <AppText variant="caption" tone="brand">
                  {interest.label}
                </AppText>
              </View>
            ))}
          </View>
        </View>
        {candidate.compatibility ? (
          <CompatibilityCard compatibility={candidate.compatibility} />
        ) : null}
      </ScrollView>
      {showActions ? (
        <View style={[styles.actions, !showLikeAction && styles.singleAction]}>
          <IconButton
            icon={X}
            label="Geç"
            danger
            disabled={disabled}
            onPress={onPass}
            style={styles.actionButton}
          />
          {showLikeAction ? (
            <IconButton
              icon={Heart}
              label="Beğen"
              selected
              disabled={disabled}
              onPress={onLike}
              style={styles.actionButton}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.match,
  },
  scrollContent: { paddingBottom: spacing.sm },
  eventContext: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.brand,
  },
  eventTitle: { flex: 1 },
  gallery: { borderRadius: 0 },
  info: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  interest: {
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actions: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 64,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  singleAction: { justifyContent: 'center' },
  actionButton: { ...shadows.floating },
});

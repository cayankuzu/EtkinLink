import { AppText, IconButton, Skeleton, StateView } from '@shared/components';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type { Event, MatchContext, Profile } from '@shared/types/domain';
import { FlashList } from '@shopify/flash-list';
import { Bookmark, Settings } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventImage } from '../events/EventImage';
import { CompatibilityCard } from '../matching/CompatibilityCard';
import { ProfilePhotoGallery } from './ProfilePhotoGallery';

type Props = {
  profile: Profile;
  upcoming: Event[];
  attended: Event[];
  selected: 'upcoming' | 'attended';
  loadingEvents: boolean;
  ownProfile: boolean;
  onSelect: (value: 'upcoming' | 'attended') => void;
  onEvent: (eventId: string) => void;
  onSettings?: () => void;
  onSaved?: () => void;
  onReportPhoto?: () => void | Promise<void>;
  matchContext?: MatchContext | null;
};

const genderLabels = {
  woman: 'Kadın',
  man: 'Erkek',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Belirtmek istemiyor',
} as const;

export function ProfileView({
  profile,
  upcoming,
  attended,
  selected,
  loadingEvents,
  ownProfile,
  onSelect,
  onEvent,
  onSettings,
  onSaved,
  onReportPhoto,
  matchContext,
}: Props) {
  const events = selected === 'upcoming' ? upcoming : attended;
  const showAge =
    profile.age !== null &&
    (!ownProfile || profile.ageVisibility === 'everyone');
  const showGender =
    profile.gender !== null &&
    (!ownProfile || profile.genderVisibility === 'everyone');
  const meta = [
    showAge ? `${profile.age} yaş` : null,
    showGender && profile.gender ? genderLabels[profile.gender] : null,
    profile.city,
  ].filter(Boolean);

  return (
    <View style={styles.wrapper}>
      {ownProfile ? (
        <View style={styles.appBar}>
          <AppText variant="heading22" style={styles.appBarTitle}>
            Profil
          </AppText>
          {onSaved ? (
            <IconButton
              icon={Bookmark}
              label="Kaydedilen etkinlikler"
              onPress={onSaved}
            />
          ) : null}
          {onSettings ? (
            <IconButton
              icon={Settings}
              label="Ayarları aç"
              onPress={onSettings}
              style={styles.plainIcon}
            />
          ) : null}
        </View>
      ) : null}

      <ProfilePhotoGallery
        photos={profile.photos}
        accessibilityName={profile.fullName}
        ownProfile={ownProfile}
        onReport={onReportPhoto}
      />

      <View style={styles.profileCard}>
        <View style={styles.identity}>
          <AppText variant="heading22" align="center">
            {profile.fullName}
          </AppText>
          <AppText variant="body14" tone="secondary" align="center">
            @{profile.username}
          </AppText>
        </View>

        {meta.length ? (
          <AppText variant="caption12" tone="secondary" align="center">
            {meta.join('  ·  ')}
          </AppText>
        ) : null}

        {profile.bio ? (
          <AppText variant="body14" tone="secondary" align="center">
            {profile.bio}
          </AppText>
        ) : null}

        <View style={styles.interests}>
          {profile.interests.map(interest => (
            <View key={interest.id} style={styles.interest}>
              <AppText variant="caption12" tone="brand">
                {interest.label}
              </AppText>
            </View>
          ))}
        </View>
      </View>

      {matchContext ? (
        <CompatibilityCard
          compatibility={matchContext.compatibility}
          matchContext={matchContext}
          onOpenEvent={onEvent}
        />
      ) : null}

      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === 'upcoming' }}
          onPress={() => onSelect('upcoming')}
          style={[styles.tab, selected === 'upcoming' && styles.tabSelected]}
        >
          <AppText
            variant="label15"
            tone={selected === 'upcoming' ? 'primary' : 'secondary'}
          >
            Katılacaklarım ({upcoming.length})
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: selected === 'attended' }}
          onPress={() => onSelect('attended')}
          style={[styles.tab, selected === 'attended' && styles.tabSelected]}
        >
          <AppText
            variant="label15"
            tone={selected === 'attended' ? 'primary' : 'secondary'}
          >
            Katıldıklarım ({attended.length})
          </AppText>
        </Pressable>
      </View>

      {loadingEvents ? (
        <View style={styles.grid}>
          <Skeleton style={styles.eventSkeleton} />
          <Skeleton style={styles.eventSkeleton} />
          <Skeleton style={styles.eventSkeleton} />
          <Skeleton style={styles.eventSkeleton} />
        </View>
      ) : events.length === 0 ? (
        <StateView
          title={
            selected === 'upcoming'
              ? 'Yaklaşan etkinlik yok'
              : 'Geçmiş etkinlik yok'
          }
          description={
            selected === 'upcoming'
              ? 'Katılacağın etkinlikler burada iki sütun hâlinde görünür.'
              : 'Katıldığın etkinlikler burada arşivlenir.'
          }
        />
      ) : (
        <FlashList
          data={events}
          numColumns={2}
          scrollEnabled={false}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <EventTile event={item} onPress={() => onEvent(item.id)} />
          )}
        />
      )}
    </View>
  );
}

function EventTile({ event, onPress }: { event: Event; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${event.title} etkinliğini aç`}
      onPress={onPress}
      style={({ pressed }) => [styles.eventTile, pressed && styles.pressed]}
    >
      <EventImage
        imageUrl={event.imageUrl}
        style={styles.eventImage}
        placeholderStyle={styles.eventFallback}
        iconSize={28}
      />
      <View style={styles.eventInfo}>
        <AppText variant="label14" numberOfLines={2}>
          {event.title}
        </AppText>
        <AppText variant="tiny11" tone="secondary">
          {new Date(event.startAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.md, paddingBottom: spacing.xl },
  appBar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
  },
  appBarTitle: { flex: 1 },
  plainIcon: { borderWidth: 0, backgroundColor: colors.transparent },
  identity: { alignItems: 'center', gap: 2 },
  profileCard: {
    ...shadows.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  interests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  interest: {
    borderRadius: radius.full,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabs: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    flexDirection: 'row',
    padding: 4,
  },
  tab: {
    flex: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  eventSkeleton: { width: '48%', aspectRatio: 0.82 },
  eventTile: {
    ...shadows.card,
    flex: 1,
    minHeight: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    margin: spacing.xs,
  },
  pressed: { opacity: 0.74 },
  eventImage: { width: '100%', aspectRatio: 1 },
  eventFallback: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventInfo: { padding: spacing.sm, gap: spacing.xxs },
});

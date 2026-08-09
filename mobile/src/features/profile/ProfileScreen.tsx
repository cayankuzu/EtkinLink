import type {
  MainTabParamList,
  ProfileStackParamList,
} from '@app/navigation/types';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorState, Screen, Skeleton } from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { supabase } from '@shared/lib/supabase';
import { spacing } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { getProfile, listProfileEvents } from './profileService';
import { ProfileView } from './ProfileView';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Profile'>;

export function ProfileScreen({ navigation }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const [selected, setSelected] = useState<'upcoming' | 'attended'>('upcoming');
  const user = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error ?? new Error('Oturum gerekli.');
      return data.user.id;
    },
  });
  const profile = useQuery({
    queryKey: ['profile', user.data],
    queryFn: () => getProfile(user.data),
    enabled: Boolean(user.data),
  });
  const upcoming = useQuery({
    queryKey: ['profile-events', user.data, 'upcoming'],
    queryFn: () => listProfileEvents(user.data ?? '', 'upcoming'),
    enabled: Boolean(user.data),
  });
  const attended = useQuery({
    queryKey: ['profile-events', user.data, 'attended'],
    queryFn: () => listProfileEvents(user.data ?? '', 'attended'),
    enabled: Boolean(user.data),
  });

  async function refreshProfile(): Promise<void> {
    await Promise.all([
      user.refetch(),
      profile.refetch(),
      upcoming.refetch(),
      attended.refetch(),
    ]);
  }

  const refreshing =
    user.isRefetching ||
    profile.isRefetching ||
    upcoming.isRefetching ||
    attended.isRefetching;

  if (user.isLoading || profile.isLoading)
    return (
      <Screen
        scroll
        scrollRef={scrollRef}
        contentStyle={styles.screen}
        refreshing={refreshing}
        onRefresh={refreshProfile}
      >
        <Skeleton style={styles.gallery} />
        <Skeleton style={styles.body} />
      </Screen>
    );
  if (user.isError || profile.isError || !profile.data)
    return (
      <Screen
        scroll
        scrollRef={scrollRef}
        refreshing={refreshing}
        onRefresh={refreshProfile}
      >
        <ErrorState
          title="Profil yüklenemedi"
          description={toAppError(user.error ?? profile.error).message}
          actionLabel="Tekrar dene"
          onAction={() => {
            void user.refetch();
            void profile.refetch();
          }}
        />
      </Screen>
    );
  return (
    <Screen
      scroll
      scrollRef={scrollRef}
      contentStyle={styles.screen}
      refreshing={refreshing}
      onRefresh={refreshProfile}
    >
      <ProfileView
        profile={profile.data}
        upcoming={upcoming.data ?? []}
        attended={attended.data ?? []}
        selected={selected}
        loadingEvents={upcoming.isLoading || attended.isLoading}
        ownProfile
        onSelect={setSelected}
        onEvent={eventId => navigation.navigate('EventDetail', { eventId })}
        onSettings={() => navigation.navigate('Settings')}
        onSaved={() =>
          navigation
            .getParent<BottomTabNavigationProp<MainTabParamList>>()
            ?.navigate('DiscoverTab', { screen: 'SavedEvents' })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.md },
  gallery: { aspectRatio: 1 },
  body: { height: 260, marginTop: spacing.md },
});

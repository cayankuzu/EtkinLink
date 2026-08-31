import {
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { queryKeys } from '@shared/lib/queryKeys';
import { spacing } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { getMatchContext } from '../matching/matchingService';
import {
  getProfile,
  listProfileEvents,
  reportProfilePhoto,
} from './profileService';
import { ProfileView } from './ProfileView';

type Props = {
  route: { params: { userId: string } };
  navigation: {
    goBack: () => void;
    navigate: (screen: 'EventDetail', params: { eventId: string }) => void;
  };
};

export function PublicProfileScreen({ route, navigation }: Props) {
  const [selected, setSelected] = useState<'upcoming' | 'attended'>('upcoming');
  const reportRequestId = useRef<string | null>(null);
  const profile = useQuery({
    queryKey: queryKeys.profile.byId(route.params.userId),
    queryFn: () => getProfile(route.params.userId),
  });
  const upcoming = useQuery({
    queryKey: queryKeys.profile.events(route.params.userId, 'upcoming'),
    queryFn: () => listProfileEvents(route.params.userId, 'upcoming'),
  });
  const attended = useQuery({
    queryKey: queryKeys.profile.events(route.params.userId, 'attended'),
    queryFn: () => listProfileEvents(route.params.userId, 'attended'),
  });
  const matchContext = useQuery({
    queryKey: queryKeys.profile.matchContext(route.params.userId),
    queryFn: () => getMatchContext(route.params.userId),
  });
  async function refreshProfile(): Promise<void> {
    await Promise.all([
      profile.refetch(),
      upcoming.refetch(),
      attended.refetch(),
      matchContext.refetch(),
    ]);
  }
  const refreshing =
    profile.isRefetching ||
    upcoming.isRefetching ||
    attended.isRefetching ||
    matchContext.isRefetching;

  async function reportPhoto(): Promise<void> {
    reportRequestId.current ??= createClientId();
    try {
      await reportProfilePhoto(
        route.params.userId,
        undefined,
        reportRequestId.current,
      );
    } catch (error) {
      Alert.alert('Şikayet gönderilemedi', toAppError(error).message);
      return;
    }
    reportRequestId.current = null;
    Alert.alert('Şikayet alındı', 'Bildirimin inceleme ekibine gönderildi.');
  }
  if (profile.isLoading)
    return (
      <Screen
        scroll
        contentStyle={styles.screen}
        refreshing={refreshing}
        onRefresh={refreshProfile}
      >
        <Skeleton style={styles.gallery} />
        <Skeleton style={styles.body} />
      </Screen>
    );
  if (profile.isError || !profile.data)
    return (
      <Screen scroll refreshing={refreshing} onRefresh={refreshProfile}>
        <ErrorState
          title="Profil açılamadı"
          description={toAppError(profile.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  return (
    <Screen
      scroll
      contentStyle={styles.screen}
      refreshing={refreshing}
      onRefresh={refreshProfile}
    >
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">Profil</AppText>
        <View style={styles.spacer} />
      </View>
      <ProfileView
        profile={profile.data}
        upcoming={upcoming.data ?? []}
        attended={attended.data ?? []}
        selected={selected}
        loadingEvents={upcoming.isLoading || attended.isLoading}
        ownProfile={false}
        onSelect={setSelected}
        onEvent={eventId => navigation.navigate('EventDetail', { eventId })}
        onReportPhoto={reportPhoto}
        matchContext={matchContext.data}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: 48 },
  gallery: { aspectRatio: 1 },
  body: { height: 260, marginTop: spacing.md },
});

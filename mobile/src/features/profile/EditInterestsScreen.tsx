import type { ProfileStackParamList } from '@app/navigation/types';
import {
  listInterests,
  saveInterests,
} from '@features/onboarding/onboardingService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { spacing } from '@shared/theme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getProfile } from './profileService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditInterests'>;

export function EditInterestsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const profile = useQuery({
    queryKey: ['profile', 'current'],
    queryFn: () => getProfile(),
  });
  const interests = useQuery({
    queryKey: ['interests'],
    queryFn: listInterests,
    staleTime: 24 * 60 * 60_000,
  });
  useEffect(() => {
    if (profile.data) setSelected(profile.data.interests.map(item => item.id));
  }, [profile.data]);
  const save = useMutation({
    mutationFn: () => saveInterests(selected),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      navigation.goBack();
    },
  });
  function toggle(id: string) {
    setSelected(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : current.length < 12
        ? [...current, id]
        : current,
    );
  }
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">İlgi alanlarını düzenle</AppText>
        <View style={styles.spacer} />
      </View>
      <AppText
        variant="caption12"
        tone={selected.length >= 3 ? 'success' : 'secondary'}
      >
        {selected.length}/12 seçildi · En az 3 seçim
      </AppText>
      {interests.isLoading || profile.isLoading ? (
        <View style={styles.chips}>
          {Array.from({ length: 16 }, (_, index) => (
            <Skeleton key={index} style={styles.skeleton} />
          ))}
        </View>
      ) : interests.isError || profile.isError ? (
        <ErrorState
          title="İlgi alanları yüklenemedi"
          description={toAppError(interests.error ?? profile.error).message}
          actionLabel="Tekrar dene"
          onAction={() => {
            void interests.refetch();
            void profile.refetch();
          }}
        />
      ) : (
        <View style={styles.chips}>
          {interests.data?.map(item => (
            <Chip
              key={item.id}
              label={item.label}
              selected={selected.includes(item.id)}
              onPress={() => toggle(item.id)}
            />
          ))}
        </View>
      )}
      {save.error ? (
        <AppText variant="caption12" tone="danger">
          {toAppError(save.error).message}
        </AppText>
      ) : null}
      <AppButton
        label="İlgi alanlarını kaydet"
        disabled={selected.length < 3}
        loading={save.isPending}
        onPress={() => save.mutate()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeleton: { width: 96, height: 44, borderRadius: 22 },
});

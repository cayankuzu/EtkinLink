import type { OnboardingStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  Skeleton,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { spacing } from '@shared/theme';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CityPicker } from './CityPicker';
import { OnboardingLayout } from './OnboardingLayout';
import { listInterests, saveProfileDetails } from './onboardingService';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Interests'>;

export function InterestsScreen({ navigation }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const interests = useQuery({
    queryKey: ['interests'],
    queryFn: listInterests,
    staleTime: 24 * 60 * 60_000,
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!city) throw new Error('Şehir seçmelisin.');
      if (bio.trim().length < 20)
        throw new Error('Biyografi en az 20 karakter olmalı.');
      return saveProfileDetails(city, bio, selected);
    },
    onSuccess: () => navigation.navigate('Photos'),
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
    <OnboardingLayout
      step={3}
      title="Profilini tamamla"
      description="Biyografin, şehrin ve seçtiğin ilgi alanları profilinde görünür."
    >
      <CityPicker value={city} onChange={setCity} />
      <TextField
        label="Biyografi"
        value={bio}
        onChangeText={setBio}
        maxLength={contentLimits.bio}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={styles.bio}
      />
      <View style={styles.selectionHeader}>
        <AppText variant="label14">İlgi Alanları</AppText>
        <AppText
          variant="caption12"
          tone={selected.length >= 3 ? 'success' : 'brand'}
        >
          {selected.length} seçildi · en az 3
        </AppText>
      </View>
      {interests.isLoading ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 14 }, (_, index) => (
            <Skeleton key={index} style={styles.skeleton} />
          ))}
        </View>
      ) : interests.isError ? (
        <ErrorState
          title="İlgi alanları yüklenemedi"
          description={toAppError(interests.error).message}
          actionLabel="Tekrar dene"
          onAction={() => void interests.refetch()}
        />
      ) : (
        <View style={styles.chips}>
          {interests.data?.map(interest => (
            <Chip
              key={interest.id}
              label={interest.label}
              selected={selected.includes(interest.id)}
              onPress={() => toggle(interest.id)}
            />
          ))}
        </View>
      )}
      {mutation.error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {toAppError(mutation.error).message}
        </AppText>
      ) : null}
      <AppButton
        label="Devam Et"
        disabled={selected.length < 3 || !city || bio.trim().length < 20}
        loading={mutation.isPending}
        onPress={() => mutation.mutate()}
      />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  bio: { minHeight: 112 },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeletons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeleton: { width: 92, height: 44, borderRadius: 22 },
});

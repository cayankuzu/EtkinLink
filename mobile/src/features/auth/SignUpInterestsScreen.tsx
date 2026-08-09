import type { AuthStackParamList } from '@app/navigation/types';
import { CityPicker } from '@features/onboarding/CityPicker';
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
import { colors, spacing } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRegistrationDraftStore } from './registrationDraftStore';
import { RegistrationLayout } from './RegistrationLayout';
import { listRegistrationInterests } from './registrationService';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUpInterests'>;

export function SignUpInterestsScreen({ navigation }: Props) {
  const saved = useRegistrationDraftStore(state => state.details);
  const setDetails = useRegistrationDraftStore(state => state.setDetails);
  const [selected, setSelected] = useState<string[]>(saved?.interestIds ?? []);
  const [city, setCity] = useState(saved?.city ?? '');
  const [bio, setBio] = useState(saved?.bio ?? '');
  const interests = useQuery({
    queryKey: ['registration-interests'],
    queryFn: listRegistrationInterests,
    staleTime: 24 * 60 * 60_000,
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

  function proceed() {
    const available = interests.data ?? [];
    setDetails({
      city,
      bio: bio.trim(),
      interestIds: selected,
      interestLabels: available
        .filter(item => selected.includes(item.id))
        .map(item => item.label),
    });
    navigation.navigate('SignUpPhotos');
  }

  const ready = selected.length >= 3 && Boolean(city);

  return (
    <RegistrationLayout
      step={3}
      title="Profilini kişiselleştir"
      description="Şehrini, kendini ve sevdiğin etkinlik türlerini ekle."
      icon={Sparkles}
      onBack={navigation.goBack}
    >
      <CityPicker value={city} onChange={setCity} />
      <TextField
        label="Kısa biyografi (isteğe bağlı)"
        placeholder="Kendinden ve katılmayı sevdiğin etkinliklerden bahset..."
        leadingIcon={BookOpenText}
        value={bio}
        onChangeText={setBio}
        maxLength={contentLimits.bio}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={styles.bio}
        hint="İstersen bu alanı boş bırakabilirsin."
      />
      <View style={styles.selectionHeader}>
        <View style={styles.labelWithIcon}>
          <Sparkles size={18} color={colors.brand} />
          <AppText variant="label14">İlgi alanları</AppText>
        </View>
        <AppText
          variant="caption12"
          tone={selected.length >= 3 ? 'success' : 'brand'}
        >
          {selected.length} seçildi · en az 3
        </AppText>
      </View>
      {interests.isLoading ? (
        <View style={styles.skeletons}>
          {Array.from({ length: 12 }, (_, index) => (
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
      <AppButton label="Devam Et" disabled={!ready} onPress={proceed} />
    </RegistrationLayout>
  );
}

const styles = StyleSheet.create({
  bio: { minHeight: 112, paddingTop: spacing.md },
  selectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeletons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeleton: { width: 92, height: 44, borderRadius: 22 },
});

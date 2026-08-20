import type { RoomsStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { premiumComingSoonMessage } from '@shared/constants/premium';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing } from '@shared/theme';
import type { ProfileGender } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Crown, LockKeyhole } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { getMatchingSettings } from './matchingService';

type Props = NativeStackScreenProps<RoomsStackParamList, 'MatchFilters'>;

const genderOptions: Array<{ value: ProfileGender; label: string }> = [
  { value: 'woman', label: 'Kadın' },
  { value: 'man', label: 'Erkek' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Belirtmeyenler' },
];

export function MatchFiltersScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const [genders, setGenders] = useState<ProfileGender[]>([]);
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('55');
  const settings = useQuery({
    queryKey: queryKeys.matching.settings(route.params.eventId),
    queryFn: () => getMatchingSettings(route.params.eventId),
  });
  const preferences = useQuery({
    queryKey: queryKeys.matching.preferences,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_preferences')
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!preferences.data) return;
    setGenders(preferences.data.gender_preference);
    setAgeMin(String(preferences.data.age_min));
    setAgeMax(String(preferences.data.age_max));
  }, [preferences.data]);
  const save = useMutation({
    mutationFn: async () => {
      const minimum = Number(ageMin);
      const maximum = Number(ageMax);
      if (
        !Number.isInteger(minimum) ||
        !Number.isInteger(maximum) ||
        minimum < 18 ||
        maximum > 99 ||
        minimum > maximum
      )
        throw new Error('Yaş aralığı 18–99 arasında ve geçerli olmalı.');
      const { error } = await supabase.rpc('set_match_filters', {
        genders,
        minimum_age: minimum,
        maximum_age: maximum,
        interest_ids: preferences.data?.required_interest_ids ?? [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.preferences,
      });
      navigation.goBack();
    },
  });
  const premium = settings.data?.premium ?? false;
  function requirePremium() {
    if (!premium) Alert.alert('Premium ile yakında', premiumComingSoonMessage);
  }
  if (settings.isError || preferences.isError)
    return (
      <Screen>
        <ErrorState
          title="Filtreler açılamadı"
          description={toAppError(settings.error ?? preferences.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">Eşleşme filtreleri</AppText>
        <Crown size={24} color={colors.warning} />
      </View>
      <View style={styles.notice}>
        <LockKeyhole
          size={20}
          color={premium ? colors.success : colors.warning}
        />
        <View style={styles.noticeText}>
          <AppText variant="label15">
            {premium ? 'Premium filtreler açık' : premiumComingSoonMessage}
          </AppText>
          <AppText variant="caption12" tone="secondary">
            Filtreler görünür; ücretsiz planda değiştirilemez. Mesafe filtresi
            özellikle bulunmaz.
          </AppText>
        </View>
      </View>
      <Pressable
        disabled={premium}
        onPress={requirePremium}
        style={styles.section}
      >
        <AppText variant="heading18">Gösterilecek kişiler</AppText>
        {!premium ? (
          <AppText variant="caption12" style={styles.comingSoonText}>
            {premiumComingSoonMessage}
          </AppText>
        ) : null}
        <View style={styles.chips}>
          {genderOptions.map(option => (
            <Chip
              key={option.value}
              label={option.label}
              selected={genders.includes(option.value)}
              disabled={!premium}
              onPress={() =>
                setGenders(current =>
                  current.includes(option.value)
                    ? current.filter(item => item !== option.value)
                    : [...current, option.value],
                )
              }
            />
          ))}
        </View>
      </Pressable>
      <Pressable
        disabled={premium}
        onPress={requirePremium}
        style={styles.section}
      >
        <AppText variant="heading18">Yaş aralığı</AppText>
        {!premium ? (
          <AppText variant="caption12" style={styles.comingSoonText}>
            {premiumComingSoonMessage}
          </AppText>
        ) : null}
        <View style={styles.ageRow}>
          <View style={styles.ageField}>
            <TextField
              label="En az"
              value={ageMin}
              maxLength={contentLimits.ageDigits}
              keyboardType="number-pad"
              editable={premium}
              onChangeText={setAgeMin}
            />
          </View>
          <View style={styles.ageField}>
            <TextField
              label="En çok"
              value={ageMax}
              maxLength={contentLimits.ageDigits}
              keyboardType="number-pad"
              editable={premium}
              onChangeText={setAgeMax}
            />
          </View>
        </View>
      </Pressable>
      <Pressable
        disabled={premium}
        onPress={requirePremium}
        style={styles.section}
      >
        <AppText variant="heading18">İlgi alanları</AppText>
        <AppText tone="secondary">
          Ortak ilgi alanlarına göre adayları daraltabilirsin.
        </AppText>
        {!premium ? (
          <AppText variant="caption12" style={styles.comingSoonText}>
            {premiumComingSoonMessage}
          </AppText>
        ) : null}
      </Pressable>
      {save.error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {toAppError(save.error).message}
        </AppText>
      ) : null}
      <AppButton
        label="Filtreleri kaydet"
        disabled={!premium || genders.length === 0}
        loading={save.isPending}
        onPress={() => save.mutate()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notice: {
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noticeText: { flex: 1, gap: spacing.xxs },
  section: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ageRow: { flexDirection: 'row', gap: spacing.md },
  ageField: { flex: 1 },
  comingSoonText: { color: colors.warning },
});

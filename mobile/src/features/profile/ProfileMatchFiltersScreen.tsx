import type { ProfileStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  TextField,
} from '@shared/components';
import { normalizeTurkishSearch } from '@shared/constants/cities';
import { premiumComingSoonMessage } from '@shared/constants/premium';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, radius, spacing } from '@shared/theme';
import type { ProfileGender } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Crown, LockKeyhole, Search } from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AgeRangeSlider } from './AgeRangeSlider';
import { CheckSelectionRow } from './CheckSelectionRow';
import {
  getProfileMatchFilterSettings,
  type ProfileMatchFilterSettings,
  saveProfileMatchFilters,
} from './profileMatchFilterService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'MatchFilters'>;

const genderOptions: Array<{ value: ProfileGender; label: string }> = [
  { value: 'woman', label: 'Kadın' },
  { value: 'man', label: 'Erkek' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Belirtmek istemeyenler' },
];

export function ProfileMatchFiltersScreen({ navigation }: Props) {
  const settings = useQuery({
    queryKey: queryKeys.profile.matchFilters,
    queryFn: getProfileMatchFilterSettings,
  });

  if (settings.isLoading) {
    return (
      <Screen scroll contentStyle={styles.screen}>
        <Skeleton style={styles.bannerSkeleton} />
        <Skeleton style={styles.cardSkeleton} />
        <Skeleton style={styles.cardSkeleton} />
      </Screen>
    );
  }
  if (settings.isError || !settings.data) {
    return (
      <Screen>
        <ErrorState
          title="Eşleşme filtreleri açılamadı"
          description={toAppError(settings.error).message}
          actionLabel="Tekrar dene"
          onAction={() => void settings.refetch()}
        />
      </Screen>
    );
  }

  return (
    <MatchFilterForm
      key={`${settings.data.ageMin}-${
        settings.data.ageMax
      }-${settings.data.genders.join('-')}-${settings.data.interestIds.join(
        '-',
      )}`}
      initial={settings.data}
      onBack={navigation.goBack}
    />
  );
}

function MatchFilterForm({
  initial,
  onBack,
}: {
  initial: ProfileMatchFilterSettings;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [genders, setGenders] = useState<ProfileGender[]>(initial.genders);
  const [ageMin, setAgeMin] = useState(initial.ageMin);
  const [ageMax, setAgeMax] = useState(initial.ageMax);
  const [interestIds, setInterestIds] = useState<string[]>(initial.interestIds);
  const [interestQuery, setInterestQuery] = useState('');
  const deferredInterestQuery = useDeferredValue(interestQuery);
  const selectedInterestIds = useMemo(
    () => new Set(interestIds),
    [interestIds],
  );
  const visibleInterests = useMemo(() => {
    const query = normalizeTurkishSearch(deferredInterestQuery.trim());
    if (!query) return initial.interests;
    return initial.interests.filter(interest =>
      normalizeTurkishSearch(interest.label).includes(query),
    );
  }, [deferredInterestQuery, initial.interests]);
  const ageValid =
    Number.isInteger(ageMin) &&
    Number.isInteger(ageMax) &&
    ageMin >= 18 &&
    ageMax <= 99 &&
    ageMin <= ageMax;
  const save = useMutation({
    mutationFn: () =>
      saveProfileMatchFilters({
        genders,
        ageMin,
        ageMax,
        interestIds,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.matchFilters,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.preferences,
      });
      onBack();
    },
  });

  function explainPremium() {
    if (initial.premium) return;
    Alert.alert('Premium eşleşme filtreleri', premiumComingSoonMessage);
  }

  function toggleGender(value: ProfileGender) {
    if (!initial.premium) {
      explainPremium();
      return;
    }
    setGenders(current =>
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value],
    );
  }

  function toggleInterest(id: string) {
    if (!initial.premium) {
      explainPremium();
      return;
    }
    setInterestIds(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id],
    );
  }

  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={onBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20">Eşleşme filtreleri</AppText>
        <View style={styles.headerIcon}>
          <Crown size={21} color={colors.warning} />
        </View>
      </View>

      <View
        style={[
          styles.premiumBanner,
          initial.premium ? styles.premiumBannerActive : null,
        ]}
      >
        <View style={styles.premiumIcon}>
          {initial.premium ? (
            <Crown size={22} color={colors.warning} />
          ) : (
            <LockKeyhole size={22} color={colors.warning} />
          )}
        </View>
        <View style={styles.bannerCopy}>
          <AppText variant="label15">
            {initial.premium
              ? 'Premium filtrelerin açık'
              : 'Premium eşleşme filtreleri'}
          </AppText>
          <AppText variant="caption12" tone="secondary">
            {initial.premium
              ? 'Tercihlerin bütün etkinliklerdeki eşleşme adaylarına uygulanır.'
              : `${premiumComingSoonMessage} Seçenekleri şimdiden inceleyebilirsin.`}
          </AppText>
        </View>
      </View>

      <FilterSection
        title="Cinsiyet"
        description="Eşleşme adaylarında görmek istediğin kişileri seç."
        disabled={!initial.premium}
      >
        <View style={styles.optionList}>
          {genderOptions.map(option => (
            <CheckSelectionRow
              key={option.value}
              label={option.label}
              selected={genders.includes(option.value)}
              disabled={!initial.premium}
              onPress={() => toggleGender(option.value)}
            />
          ))}
        </View>
        {genders.length === 0 ? (
          <AppText variant="caption12" tone="danger">
            En az bir seçenek işaretlenmeli.
          </AppText>
        ) : null}
      </FilterSection>

      <Pressable
        accessibilityRole={initial.premium ? undefined : 'button'}
        accessibilityLabel={
          initial.premium ? undefined : 'Yaş filtresi Premium özelliğidir'
        }
        onPress={initial.premium ? undefined : explainPremium}
      >
        <FilterSection
          title="Yaş aralığı"
          description="Adayların en düşük ve en yüksek yaşını belirle."
          disabled={!initial.premium}
        >
          <AgeRangeSlider
            valueMin={ageMin}
            valueMax={ageMax}
            disabled={!initial.premium}
            onChange={(nextMin, nextMax) => {
              setAgeMin(nextMin);
              setAgeMax(nextMax);
            }}
          />
        </FilterSection>
      </Pressable>

      <FilterSection
        title="Ortak ilgi alanları"
        description="Seçtiklerinden en az birine sahip adayları göster. Seçim yapmazsan bütün ilgi alanları kabul edilir."
        disabled={!initial.premium}
      >
        <TextField
          label="İlgi alanı ara"
          value={interestQuery}
          editable={initial.premium}
          leadingIcon={Search}
          placeholder="Yazdıkça filtrele"
          showCounter={false}
          onChangeText={setInterestQuery}
        />
        <AppText variant="caption12" tone="secondary">
          {interestIds.length} ilgi alanı seçildi
        </AppText>
        <View style={styles.optionList}>
          {visibleInterests.map(interest => (
            <CheckSelectionRow
              key={interest.id}
              label={interest.label}
              selected={selectedInterestIds.has(interest.id)}
              disabled={!initial.premium}
              onPress={() => toggleInterest(interest.id)}
            />
          ))}
          {visibleInterests.length === 0 ? (
            <AppText variant="body14" tone="secondary">
              Aramana uygun ilgi alanı bulunamadı.
            </AppText>
          ) : null}
        </View>
      </FilterSection>

      <View style={styles.infoNote}>
        <AppText variant="caption12" tone="secondary">
          Mesafe filtresi kullanılmaz; adaylar aynı etkinliğin katılımcıları
          arasından gösterilir.
        </AppText>
      </View>

      {save.error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {toAppError(save.error).message}
        </AppText>
      ) : null}
      <AppButton
        label={
          initial.premium
            ? 'Filtreleri kaydet'
            : 'Yakında Premium ile aktif edilecek'
        }
        disabled={!initial.premium || !ageValid || genders.length === 0}
        loading={save.isPending}
        onPress={() => save.mutate()}
      />
    </Screen>
  );
}

function FilterSection({
  title,
  description,
  disabled = false,
  children,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, disabled ? styles.sectionDisabled : null]}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionTitleRow}>
          <AppText variant="heading18" style={styles.sectionTitle}>
            {title}
          </AppText>
          <View style={styles.premiumTag}>
            <Crown size={13} color={colors.warning} />
            <AppText variant="tiny11" style={styles.premiumTagText}>
              Premium
            </AppText>
          </View>
        </View>
        <AppText variant="caption12" tone="secondary">
          {description}
        </AppText>
        {disabled ? (
          <AppText variant="caption12" style={styles.comingSoonText}>
            {premiumComingSoonMessage}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: { borderWidth: 0, backgroundColor: colors.transparent },
  headerIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
  },
  premiumBannerActive: {
    borderColor: colors.brandSoft,
    backgroundColor: colors.brandSubtle,
  },
  premiumIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  bannerCopy: { flex: 1, gap: spacing.xxs },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionDisabled: { backgroundColor: colors.surfaceMuted },
  sectionHeading: { gap: spacing.xs },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: { flex: 1 },
  premiumTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  premiumTagText: { color: colors.warning },
  comingSoonText: { color: colors.warning },
  optionList: { gap: spacing.xs },
  infoNote: {
    borderRadius: radius.md,
    backgroundColor: colors.infoSoft,
    padding: spacing.sm,
  },
  bannerSkeleton: { height: 92 },
  cardSkeleton: { height: 220 },
});

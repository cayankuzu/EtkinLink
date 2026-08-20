import type { ProfileStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing } from '@shared/theme';
import type { Profile, VisibilityLevel } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { StyleSheet, Switch, View } from 'react-native';

import { getProfile } from './profileService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileVisibility'>;
type VisibilityChoice = Exclude<VisibilityLevel, 'matches'>;
type VisibilityField = 'age_visibility' | 'gender_visibility';
type ProfileVisibilityField = 'ageVisibility' | 'genderVisibility';

async function updateVisibility(
  field: VisibilityField,
  value: VisibilityChoice,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Oturum gerekli.');
  const update =
    field === 'age_visibility'
      ? { age_visibility: value }
      : { gender_visibility: value };
  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', auth.user.id);
  if (error) throw error;
}

function useVisibilityMutation(
  databaseField: VisibilityField,
  profileField: ProfileVisibilityField,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: VisibilityChoice) =>
      updateVisibility(databaseField, value),
    onMutate: async value => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile.current });
      const previous = queryClient.getQueryData<Profile>(
        queryKeys.profile.current,
      )?.[profileField];
      queryClient.setQueryData<Profile>(queryKeys.profile.current, current =>
        current ? { ...current, [profileField]: value } : current,
      );
      return { previous };
    },
    onError: (_error, _value, context) => {
      if (!context?.previous) return;
      queryClient.setQueryData<Profile>(queryKeys.profile.current, current =>
        current ? { ...current, [profileField]: context.previous } : current,
      );
    },
  });
}

export function ProfileVisibilityScreen({ navigation }: Props) {
  const profile = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: () => getProfile(),
  });
  const ageSave = useVisibilityMutation('age_visibility', 'ageVisibility');
  const genderSave = useVisibilityMutation(
    'gender_visibility',
    'genderVisibility',
  );
  if (profile.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.card} />
        <Skeleton style={styles.card} />
      </Screen>
    );
  if (profile.isError || !profile.data)
    return (
      <Screen>
        <ErrorState
          title="Görünürlük açılamadı"
          description={toAppError(profile.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20">Profil görünürlüğü</AppText>
        <View style={styles.spacer} />
      </View>
      <VisibilityCard
        title="Yaş görünürlüğü"
        description="Yaşının diğer kullanıcıların profil ekranında gösterilip gösterilmeyeceğini seç."
        value={profile.data.ageVisibility}
        saving={ageSave.isPending}
        onChange={value => ageSave.mutate(value)}
      />
      <VisibilityCard
        title="Cinsiyet görünürlüğü"
        description="Cinsiyet bilgisinin diğer kullanıcıların profil ekranında gösterilip gösterilmeyeceğini seç."
        value={profile.data.genderVisibility}
        saving={genderSave.isPending}
        onChange={value => genderSave.mutate(value)}
      />
      <AppText variant="caption12" tone="secondary">
        Seçimlerin aday kartlarında, profil detaylarında ve sohbetten açılan
        profillerde uygulanır.
      </AppText>
      {ageSave.error || genderSave.error ? (
        <AppText variant="caption12" tone="danger">
          {toAppError(ageSave.error ?? genderSave.error).message}
        </AppText>
      ) : null}
    </Screen>
  );
}

function VisibilityCard({
  title,
  description,
  value,
  saving,
  onChange,
}: {
  title: string;
  description: string;
  value: VisibilityLevel;
  saving: boolean;
  onChange: (value: VisibilityChoice) => void;
}) {
  const visible = value === 'everyone';
  return (
    <View style={styles.card}>
      <View style={styles.cardTitle}>
        <AppText variant="heading18">{title}</AppText>
        <AppText variant="caption12" tone="secondary">
          {description}
        </AppText>
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <AppText variant="label15">Profilde göster</AppText>
          <AppText variant="caption12" tone="secondary">
            {visible
              ? 'Herkes bu bilgiyi görebilir.'
              : 'Bu bilgi profilinde gizlenir.'}
          </AppText>
        </View>
        <Switch
          accessibilityLabel={`${title}: profilde göster`}
          accessibilityState={{ checked: visible, disabled: saving }}
          value={visible}
          disabled={saving}
          trackColor={{ false: colors.borderStrong, true: colors.brandSoft }}
          thumbColor={visible ? colors.brand : colors.surface}
          ios_backgroundColor={colors.borderStrong}
          onValueChange={nextVisible =>
            onChange(nextVisible ? 'everyone' : 'hidden')
          }
        />
      </View>
    </View>
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
  spacer: { width: 48 },
  headerButton: { borderWidth: 0, backgroundColor: colors.transparent },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardTitle: { gap: spacing.xs },
  switchRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  switchCopy: { flex: 1, gap: spacing.xxs },
});

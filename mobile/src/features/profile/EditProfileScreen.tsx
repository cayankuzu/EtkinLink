import type { ProfileStackParamList } from '@app/navigation/types';
import { CityPicker } from '@features/onboarding/CityPicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import {
  getUsernameValidationError,
  isUsernameAvailable,
  normalizeUsername,
} from '@shared/lib/username';
import { spacing } from '@shared/theme';
import type { ProfileGender } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  AtSign,
  BookOpenText,
  Mail,
  UserRound,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getProfile } from './profileService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditProfile'>;
const genders: Array<{ value: ProfileGender; label: string }> = [
  { value: 'woman', label: 'Kadın' },
  { value: 'man', label: 'Erkek' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Belirtmek istemiyorum' },
];

export function EditProfileScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const profile = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: () => getProfile(),
  });
  const accountEmail = useQuery({
    queryKey: queryKeys.profile.accountEmail,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error ?? new Error('Oturum gerekli.');
      return data.user.email ?? '';
    },
    staleTime: 5 * 60_000,
  });
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [gender, setGender] = useState<ProfileGender>('prefer_not_to_say');
  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.fullName);
      setUsername(profile.data.username);
      setCity(profile.data.city);
      setBio(profile.data.bio);
      setGender(profile.data.gender ?? 'prefer_not_to_say');
    }
  }, [profile.data]);
  const save = useMutation({
    mutationFn: async () => {
      if (fullName.trim().length < 2)
        throw new Error('Ad soyad en az 2 karakter olmalı.');
      const normalizedUsername = normalizeUsername(username);
      const usernameError = getUsernameValidationError(normalizedUsername);
      if (usernameError) throw new Error(usernameError);
      if (!(await isUsernameAvailable(normalizedUsername)))
        throw new Error('Bu kullanıcı adı daha önce alınmış.');
      if (!city) throw new Error('Şehir seçmelisin.');
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Oturum gerekli.');
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          username: normalizedUsername,
          city,
          bio: bio.trim() || null,
          gender,
        })
        .eq('id', auth.user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      navigation.goBack();
    },
  });
  if (profile.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  if (profile.isError)
    return (
      <Screen>
        <ErrorState
          title="Profil açılamadı"
          description={toAppError(profile.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20">Profili düzenle</AppText>
        <View style={styles.spacer} />
      </View>
      <AppText variant="caption12" tone="secondary">
        Fotoğraflar ve ilgi alanları profilinde görünür. E-posta adresin herkese
        kapalıdır.
      </AppText>
      <View style={styles.quickActions}>
        <AppButton
          label="Fotoğrafları Düzenle"
          variant="secondary"
          fullWidth={false}
          style={styles.quickAction}
          onPress={() => navigation.navigate('EditPhotos')}
        />
        <AppButton
          label="İlgi Alanları"
          variant="secondary"
          fullWidth={false}
          style={styles.quickAction}
          onPress={() => navigation.navigate('EditInterests')}
        />
      </View>
      <TextField
        label="Ad soyad"
        leadingIcon={UserRound}
        value={fullName}
        maxLength={contentLimits.fullName}
        autoCapitalize="words"
        onChangeText={setFullName}
      />
      <TextField
        label="E-posta"
        leadingIcon={Mail}
        value={accountEmail.data ?? ''}
        editable={false}
        showCounter={false}
        autoCapitalize="none"
        hint="E-posta adresi profil düzenleme ekranından değiştirilemez."
      />
      <TextField
        label="Kullanıcı adı"
        leadingIcon={AtSign}
        value={username}
        maxLength={contentLimits.username}
        autoCapitalize="none"
        onChangeText={value => setUsername(value.toLocaleLowerCase('tr-TR'))}
        hint="3–24 karakter; küçük harf, rakam ve arada alt çizgi kullanabilirsin."
      />
      <CityPicker value={city} onChange={setCity} />
      <TextField
        label="Biyografi (isteğe bağlı)"
        leadingIcon={BookOpenText}
        value={bio}
        maxLength={contentLimits.bio}
        multiline
        numberOfLines={4}
        onChangeText={setBio}
        hint="İstersen bu alanı boş bırakabilirsin."
      />
      <View style={styles.section}>
        <AppText variant="label14">Cinsiyet</AppText>
        <View style={styles.chips}>
          {genders.map(item => (
            <Chip
              key={item.value}
              label={item.label}
              selected={gender === item.value}
              onPress={() => setGender(item.value)}
            />
          ))}
        </View>
      </View>
      {save.error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {toAppError(save.error).message}
        </AppText>
      ) : null}
      <AppButton
        label="Değişiklikleri kaydet"
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
  spacer: { width: 48 },
  headerButton: { borderWidth: 0, backgroundColor: 'transparent' },
  section: { gap: spacing.sm },
  quickActions: { flexDirection: 'row', gap: spacing.sm },
  quickAction: { flex: 1, paddingHorizontal: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  skeleton: { height: 72 },
});

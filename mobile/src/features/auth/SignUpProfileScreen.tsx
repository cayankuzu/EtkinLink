import type { AuthStackParamList } from '@app/navigation/types';
import {
  profileBasicsSchema,
  type ProfileBasicsValues,
} from '@features/onboarding/onboardingSchemas';
import { zodResolver } from '@hookform/resolvers/zod';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, Chip, TextField } from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { useAvailabilityCheck } from '@shared/hooks/useAvailabilityCheck';
import { toAppError } from '@shared/lib/errors';
import {
  getUsernameValidationError,
  isUsernameAvailable,
  normalizeUsername,
} from '@shared/lib/username';
import { colors, layout, radius, spacing } from '@shared/theme';
import {
  AtSign,
  CalendarDays,
  ContactRound,
  UserRound,
  UsersRound,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useRegistrationDraftStore } from './registrationDraftStore';
import { RegistrationLayout } from './RegistrationLayout';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUpProfile'>;

const genderOptions = [
  { value: 'woman' as const, label: 'Kadın' },
  { value: 'man' as const, label: 'Erkek' },
  { value: 'non_binary' as const, label: 'Non-binary' },
  { value: 'prefer_not_to_say' as const, label: 'Belirtmek istemiyorum' },
];

function isValidUsername(value: string): boolean {
  return getUsernameValidationError(value) === null;
}

export function SignUpProfileScreen({ navigation }: Props) {
  const savedBasics = useRegistrationDraftStore(state => state.basics);
  const setBasics = useRegistrationDraftStore(state => state.setBasics);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const defaultBirthDate = new Date(
    new Date().setFullYear(new Date().getFullYear() - 20),
  );
  const {
    control,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileBasicsValues>({
    resolver: zodResolver(profileBasicsSchema),
    defaultValues: savedBasics ?? {
      fullName: '',
      username: '',
      birthDate: defaultBirthDate,
      gender: 'prefer_not_to_say',
    },
  });
  const username = useWatch({ control, name: 'username' });
  const usernameAvailability = useAvailabilityCheck({
    value: username,
    normalize: normalizeUsername,
    isValid: isValidUsername,
    check: isUsernameAvailable,
  });

  useEffect(() => {
    if (usernameAvailability === 'unavailable') {
      setError('username', {
        type: 'availability',
        message: 'Bu kullanıcı adı daha önce alınmış.',
      });
    } else if (usernameAvailability === 'available') {
      clearErrors('username');
    } else if (usernameAvailability === 'error') {
      setError('username', {
        type: 'availability',
        message: 'Kullanıcı adı uygunluğu kontrol edilemedi. Tekrar dene.',
      });
    }
  }, [clearErrors, setError, usernameAvailability]);

  const onSubmit = handleSubmit(async values => {
    try {
      const normalizedUsername = normalizeUsername(values.username);
      if (!(await isUsernameAvailable(normalizedUsername))) {
        setError('username', {
          type: 'validate',
          message: 'Bu kullanıcı adı daha önce alınmış.',
        });
        return;
      }
      setBasics({ ...values, username: normalizedUsername });
      navigation.navigate('SignUpInterests');
    } catch (error) {
      setError('username', {
        type: 'server',
        message: toAppError(error).message,
      });
    }
  });

  return (
    <RegistrationLayout
      step={2}
      title="Seni tanıyalım"
      description="Bu bilgiler, e-posta adresin hariç profilinde görünür."
      icon={ContactRound}
      onBack={navigation.goBack}
    >
      <Controller
        control={control}
        name="fullName"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="Ad soyad"
            placeholder="Adını ve soyadını yaz"
            leadingIcon={UserRound}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.fullName?.message}
            maxLength={contentLimits.fullName}
            autoCapitalize="words"
            autoComplete="name"
          />
        )}
      />
      <Controller
        control={control}
        name="username"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="Kullanıcı adı"
            placeholder="ornek_kullanici"
            leadingIcon={AtSign}
            value={value}
            onChangeText={text => {
              clearErrors('username');
              onChange(text.toLocaleLowerCase('tr-TR'));
            }}
            onBlur={onBlur}
            error={errors.username?.message}
            hint={
              usernameAvailability === 'checking'
                ? 'Kullanıcı adı kontrol ediliyor…'
                : usernameAvailability === 'available'
                ? 'Kullanıcı adı kullanılabilir.'
                : '3–24 karakter; küçük harf, rakam ve arada alt çizgi kullanabilirsin.'
            }
            maxLength={contentLimits.username}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
      />
      <Controller
        control={control}
        name="birthDate"
        render={({ field: { onChange, value } }) => (
          <View style={styles.fieldGroup}>
            <AppText variant="labelSm">Doğum tarihi</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Doğum tarihi seç"
              onPress={() => setShowDatePicker(true)}
              style={styles.dateButton}
            >
              <CalendarDays size={20} color={colors.textTertiary} />
              <AppText>{value.toLocaleDateString('tr-TR')}</AppText>
            </Pressable>
            {showDatePicker ? (
              <DateTimePicker
                value={value}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={
                  new Date(
                    new Date().setFullYear(new Date().getFullYear() - 18),
                  )
                }
                minimumDate={new Date(1927, 0, 1)}
                onChange={(_event, date) => {
                  if (Platform.OS === 'android') setShowDatePicker(false);
                  if (date) onChange(date);
                }}
              />
            ) : null}
            {errors.birthDate ? (
              <AppText variant="caption" tone="danger">
                {errors.birthDate.message}
              </AppText>
            ) : null}
          </View>
        )}
      />
      <Controller
        control={control}
        name="gender"
        render={({ field: { onChange, value } }) => (
          <View style={styles.fieldGroup}>
            <View style={styles.labelWithIcon}>
              <UsersRound size={18} color={colors.textSecondary} />
              <AppText variant="labelSm">Cinsiyet</AppText>
            </View>
            <View style={styles.chips}>
              {genderOptions.map(option => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={value === option.value}
                  onPress={() => onChange(option.value)}
                />
              ))}
            </View>
          </View>
        )}
      />
      <AppButton
        label="Devam Et"
        disabled={usernameAvailability !== 'available'}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
    </RegistrationLayout>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: spacing.xs },
  dateButton: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelWithIcon: {
    minHeight: layout.compactTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});

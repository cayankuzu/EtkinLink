import type { OnboardingStackParamList } from '@app/navigation/types';
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
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { OnboardingLayout } from './OnboardingLayout';
import {
  profileBasicsSchema,
  type ProfileBasicsValues,
} from './onboardingSchemas';
import { saveProfileBasics } from './onboardingService';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'ProfileBasics'>;
const genderOptions = [
  { value: 'woman' as const, label: 'Kadın' },
  { value: 'man' as const, label: 'Erkek' },
  { value: 'non_binary' as const, label: 'Non-binary' },
  { value: 'prefer_not_to_say' as const, label: 'Belirtmek istemiyorum' },
];

function isValidUsername(value: string): boolean {
  return getUsernameValidationError(value) === null;
}

export function ProfileBasicsScreen({ navigation }: Props) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
    defaultValues: {
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
        message: 'Bu kullanıcı adı kullanılıyor.',
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
    setSubmitError(null);
    try {
      const normalizedUsername = normalizeUsername(values.username);
      if (!(await isUsernameAvailable(normalizedUsername))) {
        setError('username', {
          type: 'availability',
          message: 'Bu kullanıcı adı kullanılıyor.',
        });
        return;
      }
      await saveProfileBasics({ ...values, username: normalizedUsername });
      navigation.navigate('Interests');
    } catch (error) {
      const appError = toAppError(error);
      setSubmitError(
        appError.message.includes('duplicate')
          ? 'Bu kullanıcı adı kullanılıyor.'
          : appError.message,
      );
    }
  });
  return (
    <OnboardingLayout
      step={2}
      title="Kendini tanıt"
      description="E-posta dışında bu bilgiler profilinde görünür."
    >
      <Controller
        control={control}
        name="fullName"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="Ad Soyad"
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
                : 'Küçük harf, rakam ve alt çizgi'
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
            <AppText variant="label14">Doğum tarihi</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Doğum tarihi seç"
              onPress={() => setShowDatePicker(true)}
              style={styles.dateButton}
            >
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
              <AppText variant="caption12" tone="danger">
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
            <AppText variant="label14">Cinsiyet</AppText>
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
            {errors.gender ? (
              <AppText variant="caption12" tone="danger">
                {errors.gender.message}
              </AppText>
            ) : null}
          </View>
        )}
      />
      {submitError ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {submitError}
        </AppText>
      ) : null}
      <AppButton
        label="Devam Et"
        disabled={usernameAvailability !== 'available'}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: spacing.xs },
  dateButton: {
    minHeight: layout.touchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});

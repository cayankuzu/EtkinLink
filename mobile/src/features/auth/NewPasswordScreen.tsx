import type { AuthStackParamList } from '@app/navigation/types';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, TextField } from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AuthLayout } from './AuthLayout';
import { newPasswordSchema, type NewPasswordValues } from './authSchemas';
import { updatePassword } from './authService';

type Props = NativeStackScreenProps<AuthStackParamList, 'NewPassword'>;

export function NewPasswordScreen({ navigation }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = handleSubmit(async values => {
    try {
      await updatePassword(values.password);
      navigation.popToTop();
    } catch (error) {
      setMessage(toAppError(error).message);
    }
  });
  return (
    <AuthLayout
      title="Yeni şifreni belirle"
      description="Önceki şifrenle aynı olmayan güçlü bir şifre seç."
    >
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="Yeni şifre"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            hint="En az 10 karakter, büyük-küçük harf ve rakam"
            maxLength={contentLimits.password}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
        )}
      />
      {message ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {message}
        </AppText>
      ) : null}
      <AppButton
        label="Şifreyi güncelle"
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
    </AuthLayout>
  );
}

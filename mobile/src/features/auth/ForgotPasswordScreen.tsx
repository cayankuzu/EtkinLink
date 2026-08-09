import type { AuthStackParamList } from '@app/navigation/types';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, TextField } from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AuthLayout } from './AuthLayout';
import { forgotPasswordSchema, type ForgotPasswordValues } from './authSchemas';
import { sendPasswordReset } from './authService';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const onSubmit = handleSubmit(async values => {
    try {
      await sendPasswordReset(values.email);
      navigation.replace('ResetEmailSent', { email: values.email });
    } catch (error) {
      setMessage(toAppError(error).message);
    }
  });
  return (
    <AuthLayout
      title="Şifreni yenile"
      description="E-posta adresine güvenli bir şifre yenileme bağlantısı göndereceğiz."
    >
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="E-posta"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.email?.message}
            maxLength={contentLimits.email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
        )}
      />
      {message ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {message}
        </AppText>
      ) : null}
      <AppButton
        label="Yenileme bağlantısı gönder"
        loading={isSubmitting}
        onPress={() => void onSubmit()}
      />
    </AuthLayout>
  );
}

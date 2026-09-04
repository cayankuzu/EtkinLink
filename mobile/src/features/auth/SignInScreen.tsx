import type { AuthStackParamList } from '@app/navigation/types';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, TextField } from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, spacing } from '@shared/theme';
import {
  AlertCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AuthLayout } from './AuthLayout';
import { signInSchema, type SignInValues } from './authSchemas';
import { signIn } from './authService';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignIn'>;

export function SignInScreen({ navigation }: Props) {
  const passwordRef = useRef<TextInput>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async values => {
    setSubmitError(null);
    try {
      await signIn(values);
    } catch (error) {
      const appError = toAppError(error);
      setSubmitError(
        appError.code === 'unknown'
          ? 'E-posta veya şifre hatalı. Bilgilerini kontrol edip tekrar dene.'
          : appError.message,
      );
    }
  });

  return (
    <AuthLayout
      presentation="heroCard"
      eyebrow="Etkinliklerin seni bekliyor"
      title="Tekrar hoş geldin"
      description="Odalarına, eşleşmelerine ve yeni etkinliklere kaldığın yerden devam et."
      onBack={navigation.goBack}
      footer={
        <View style={styles.footerRow}>
          <AppText tone="secondary">EtkinLink'te yeni misin?</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('SignUp')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.footerAction,
              pressed && styles.pressed,
            ]}
          >
            <AppText variant="label" tone="brand">
              Hesap oluştur
            </AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.formIntro}>
        <AppText variant="headingMd">Hesabına giriş yap</AppText>
        <AppText variant="body" tone="secondary">
          Kayıt olurken kullandığın bilgilerle devam et.
        </AppText>
      </View>

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            testID="sign-in-email"
            label="E-posta adresi"
            placeholder="ornek@eposta.com"
            leadingIcon={Mail}
            value={value}
            onChangeText={text => {
              setSubmitError(null);
              onChange(text);
            }}
            onBlur={onBlur}
            error={errors.email?.message}
            maxLength={contentLimits.email}
            showCounter={false}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            testID="sign-in-password"
            ref={passwordRef}
            label="Şifre"
            placeholder="Şifreni gir"
            leadingIcon={LockKeyhole}
            value={value}
            onChangeText={text => {
              setSubmitError(null);
              onChange(text);
            }}
            onBlur={onBlur}
            error={errors.password?.message}
            maxLength={contentLimits.password}
            showCounter={false}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => void onSubmit()}
          />
        )}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('ForgotPassword')}
        hitSlop={8}
        style={({ pressed }) => [styles.forgot, pressed && styles.pressed]}
      >
        <AppText variant="labelSm" tone="brand">
          Şifremi unuttum
        </AppText>
      </Pressable>

      {submitError ? <InlineError message={submitError} /> : null}

      <AppButton
        label="Giriş Yap"
        testID="sign-in-submit"
        loading={isSubmitting}
        onPress={() => void onSubmit()}
        style={styles.submit}
      />

      <View style={styles.trustNote}>
        <ShieldCheck size={18} color={colors.success} />
        <AppText variant="caption" tone="secondary" style={styles.trustText}>
          Oturum bilgilerin güvenli bağlantı üzerinden korunur.
        </AppText>
      </View>
    </AuthLayout>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.errorCard} accessibilityRole="alert">
      <AlertCircle size={18} color={colors.danger} />
      <AppText variant="caption" tone="danger" style={styles.errorText}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  formIntro: { gap: spacing.xxs, marginBottom: spacing.xxs },
  forgot: {
    alignSelf: 'flex-end',
    minHeight: 32,
    justifyContent: 'center',
    marginTop: -spacing.xs,
  },
  submit: { minHeight: 48, borderRadius: radius.lg, marginTop: spacing.xxs },
  trustNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xxs,
  },
  trustText: { flexShrink: 1 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: { flex: 1 },
  footerRow: {
    minHeight: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  footerAction: { minHeight: 44, justifyContent: 'center' },
  pressed: { opacity: 0.65 },
});

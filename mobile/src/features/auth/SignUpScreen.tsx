import type { AuthStackParamList } from '@app/navigation/types';
import { zodResolver } from '@hookform/resolvers/zod';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, TextField } from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { useAvailabilityCheck } from '@shared/hooks/useAvailabilityCheck';
import { colors, radius, spacing } from '@shared/theme';
import { Check, LockKeyhole, Mail, Route } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AuthLayout } from './AuthLayout';
import { signUpSchema, type SignUpValues } from './authSchemas';
import { isEmailAvailable, normalizeEmail } from './authService';
import { useRegistrationDraftStore } from './registrationDraftStore';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

function isValidEmail(value: string): boolean {
  return signUpSchema.shape.email.safeParse(value).success;
}

export function SignUpScreen({ navigation }: Props) {
  const passwordRef = useRef<TextInput>(null);
  const draftEmail = useRegistrationDraftStore(state => state.email);
  const setCredentials = useRegistrationDraftStore(
    state => state.setCredentials,
  );
  const {
    control,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: draftEmail, password: '' },
  });
  const email = useWatch({ control, name: 'email' });
  const password = useWatch({ control, name: 'password' });
  const passwordState = useMemo(() => getPasswordState(password), [password]);
  const emailAvailability = useAvailabilityCheck({
    value: email,
    normalize: normalizeEmail,
    isValid: isValidEmail,
    check: isEmailAvailable,
  });

  useEffect(() => {
    if (emailAvailability === 'unavailable') {
      setError('email', {
        type: 'availability',
        message: 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.',
      });
    } else if (emailAvailability === 'available') {
      clearErrors('email');
    } else if (emailAvailability === 'error') {
      setError('email', {
        type: 'availability',
        message: 'E-posta uygunluğu kontrol edilemedi. Tekrar dene.',
      });
    }
  }, [clearErrors, emailAvailability, setError]);

  const onSubmit = handleSubmit(async values => {
    const normalizedEmail = normalizeEmail(values.email);
    try {
      if (!(await isEmailAvailable(normalizedEmail))) {
        setError('email', {
          type: 'availability',
          message: 'Bu e-posta adresiyle daha önce hesap oluşturulmuş.',
        });
        return;
      }
      setCredentials(normalizedEmail, values.password);
      navigation.navigate('SignUpProfile');
    } catch {
      setError('email', {
        type: 'availability',
        message: 'E-posta uygunluğu kontrol edilemedi. Tekrar dene.',
      });
    }
  });

  return (
    <AuthLayout
      presentation="heroCard"
      eyebrow="1. adım · 5 adımda tamamla"
      title="Hesabını oluşturalım"
      description="Etkinliklerde güvenle sosyalleşmek için temel hesap bilgilerinle başla."
      onBack={navigation.goBack}
      footer={
        <View style={styles.footerRow}>
          <AppText tone="secondary">Zaten hesabın var mı?</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('SignIn')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.footerAction,
              pressed && styles.pressed,
            ]}
          >
            <AppText variant="label15" tone="brand">
              Giriş yap
            </AppText>
          </Pressable>
        </View>
      }
    >
      <View style={styles.progressHeader}>
        <View style={styles.stepBadge}>
          <AppText variant="caption12" tone="brand">
            HESAP BİLGİLERİ
          </AppText>
        </View>
        <AppText variant="caption12" tone="secondary">
          %20 tamamlandı
        </AppText>
      </View>
      <View
        style={styles.progressTrack}
        accessibilityLabel="Kayıt süreci yüzde 20 tamamlandı"
      >
        <View style={styles.progressFill} />
      </View>

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <TextField
            label="E-posta adresi"
            placeholder="ornek@eposta.com"
            leadingIcon={Mail}
            value={value}
            onChangeText={text => {
              clearErrors('email');
              onChange(text);
            }}
            onBlur={onBlur}
            error={errors.email?.message}
            hint={
              emailAvailability === 'checking'
                ? 'E-posta uygunluğu kontrol ediliyor…'
                : emailAvailability === 'available'
                ? 'E-posta adresi kullanılabilir.'
                : undefined
            }
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
            ref={passwordRef}
            label="Şifre oluştur"
            placeholder="Güçlü bir şifre belirle"
            leadingIcon={LockKeyhole}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.password?.message}
            maxLength={contentLimits.password}
            showCounter={false}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void onSubmit()}
          />
        )}
      />

      <PasswordStrength password={password} {...passwordState} />

      <AppButton
        label="Diğer Bilgilere Geç"
        disabled={emailAvailability !== 'available'}
        loading={isSubmitting}
        onPress={() => void onSubmit()}
        style={styles.submit}
      />

      <View style={styles.flowNote}>
        <Route size={18} color={colors.brand} />
        <AppText variant="caption12" tone="secondary" style={styles.flowText}>
          Bu adım e-posta göndermez. Doğrulama bağlantısı tüm adımları
          tamamladıktan sonra gönderilir.
        </AppText>
      </View>
    </AuthLayout>
  );
}

function getPasswordState(password: string) {
  const checks = [
    password.length >= 10,
    /[a-zçğıöşü]/.test(password),
    /[A-ZÇĞİÖŞÜ]/.test(password),
    /[0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const label = score <= 1 ? 'Zayıf' : score <= 3 ? 'Orta' : 'Güçlü';
  return { checks, score, label };
}

function PasswordStrength({
  password,
  checks,
  score,
  label,
}: {
  password: string;
  checks: boolean[];
  score: number;
  label: string;
}) {
  const requirements = [
    'En az 10 karakter',
    'Küçük harf',
    'Büyük harf',
    'Rakam',
  ];
  return (
    <View style={styles.strengthBox}>
      <View style={styles.strengthHeader}>
        <AppText variant="caption12" tone="secondary">
          Şifre güvenliği
        </AppText>
        {password.length > 0 ? (
          <AppText
            variant="caption12"
            tone={score === 4 ? 'success' : score <= 1 ? 'danger' : 'brand'}
          >
            {label}
          </AppText>
        ) : null}
      </View>
      <View style={styles.strengthBars}>
        {requirements.map((requirement, index) => (
          <View
            key={requirement}
            style={[
              styles.strengthBar,
              index < score &&
                (score === 4
                  ? styles.strengthStrong
                  : score <= 1
                  ? styles.strengthWeak
                  : styles.strengthMedium),
            ]}
          />
        ))}
      </View>
      <View style={styles.requirements}>
        {requirements.map((requirement, index) => (
          <View key={requirement} style={styles.requirement}>
            <View style={[styles.check, checks[index] && styles.checkDone]}>
              {checks[index] ? (
                <Check size={10} color={colors.textInverse} />
              ) : null}
            </View>
            <AppText
              variant="tiny11"
              tone={checks[index] ? 'secondary' : 'tertiary'}
            >
              {requirement}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  stepBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
  },
  progressTrack: {
    height: 6,
    marginTop: -spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    width: '20%',
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  strengthBox: {
    marginTop: -spacing.xs,
    padding: spacing.sm,
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
  },
  strengthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  strengthBars: { flexDirection: 'row', gap: spacing.xxs },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  strengthWeak: { backgroundColor: colors.danger },
  strengthMedium: { backgroundColor: colors.brand },
  strengthStrong: { backgroundColor: colors.success },
  requirements: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  requirement: {
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  check: {
    width: 14,
    height: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { borderColor: colors.success, backgroundColor: colors.success },
  submit: { minHeight: 54, borderRadius: radius.lg, marginTop: spacing.xxs },
  flowNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  flowText: { flex: 1 },
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

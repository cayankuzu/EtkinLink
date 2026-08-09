import type { AuthStackParamList } from '@app/navigation/types';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, Screen } from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, spacing } from '@shared/theme';
import {
  ExternalLink,
  House,
  MailCheck,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';

import { resendSignUpEmail } from './authService';
import { checkPendingVerification } from './pendingVerificationService';

type Props = NativeStackScreenProps<AuthStackParamList, 'EmailSent'>;
type Feedback = {
  text: string;
  tone: 'brand' | 'danger' | 'success';
};

export function EmailSentScreen({ route, navigation }: Props) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => true,
      );
      return () => subscription.remove();
    }, []),
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(
      () => setCooldown(value => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [cooldown]);

  async function checkVerification() {
    setChecking(true);
    setFeedback(null);
    try {
      const result = await checkPendingVerification(route.params.email);
      if (result === 'pending') {
        setFeedback({
          text: 'E-posta adresin henüz doğrulanmamış. E-postadaki bağlantıya dokunduktan sonra tekrar kontrol et.',
          tone: 'brand',
        });
      } else if (result === 'missing') {
        setFeedback({
          text: 'Güvenli doğrulama bilgisi bu cihazda bulunamadı. E-postadaki bağlantıya dokunarak uygulamaya dönebilirsin.',
          tone: 'danger',
        });
      } else if (result === 'credentials_invalid') {
        setFeedback({
          text: 'Bu hesap için cihazda saklanan şifre güncel değil. Yeni doğrulama e-postasını aç; ardından gerekirse ana sayfadaki “Şifremi unuttum” adımıyla şifreni yenile.',
          tone: 'brand',
        });
      } else {
        setFeedback({
          text: 'E-posta doğrulandı. Hesabına giriş yapılıyor…',
          tone: 'success',
        });
      }
    } catch (error) {
      setFeedback({ text: toAppError(error).message, tone: 'danger' });
    } finally {
      setChecking(false);
    }
  }

  async function resend() {
    if (cooldown > 0) return;
    setResending(true);
    setFeedback(null);
    try {
      await resendSignUpEmail(route.params.email);
      setCooldown(60);
      setFeedback({
        text: 'Yeni doğrulama bağlantısı gönderildi.',
        tone: 'success',
      });
    } catch (error) {
      setFeedback({ text: toAppError(error).message, tone: 'danger' });
    } finally {
      setResending(false);
    }
  }

  async function openEmailApp() {
    const candidates =
      Platform.OS === 'ios' ? ['message://', 'mailto:'] : ['mailto:'];
    try {
      for (const url of candidates) {
        if (await Linking.canOpenURL(url)) {
          await Linking.openURL(url);
          return;
        }
      }
      throw new Error(
        'Cihazında açılabilecek bir e-posta uygulaması bulunamadı.',
      );
    } catch (error) {
      setFeedback({ text: toAppError(error).message, tone: 'danger' });
    }
  }

  function goHome() {
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  }

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <AppText variant="label15" tone="brand">
          EtkinLink
        </AppText>
        <View style={styles.secureBadge}>
          <ShieldCheck size={16} color={colors.success} />
          <AppText variant="tiny11" tone="success">
            Güvenli doğrulama
          </AppText>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.icon}>
          <MailCheck size={42} color={colors.brand} />
        </View>
        <AppText variant="heading24" align="center">
          E-postanı doğrula
        </AppText>
        <AppText variant="body14" tone="secondary" align="center">
          {route.params.email} adresine gönderdiğimiz bağlantıya dokun. Ardından
          bu ekrana dönüp doğrulama durumunu kontrol et.
        </AppText>
      </View>

      <View style={styles.steps}>
        <View style={styles.stepRow}>
          <View style={styles.stepNumber}>
            <AppText variant="label14" tone="brand">
              1
            </AppText>
          </View>
          <AppText variant="body14" tone="secondary" style={styles.stepText}>
            E-posta uygulamanı aç ve doğrulama bağlantısına dokun.
          </AppText>
        </View>
        <View style={styles.stepRow}>
          <View style={styles.stepNumber}>
            <AppText variant="label14" tone="brand">
              2
            </AppText>
          </View>
          <AppText variant="body14" tone="secondary" style={styles.stepText}>
            Uygulamaya dön ve aşağıdaki kontrol düğmesini kullan.
          </AppText>
        </View>
      </View>

      {feedback ? (
        <View
          style={[
            styles.feedback,
            feedback.tone === 'danger' && styles.feedbackDanger,
            feedback.tone === 'success' && styles.feedbackSuccess,
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <AppText variant="caption12" tone={feedback.tone} align="center">
            {feedback.text}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <AppButton
          label="Doğrulama Durumunu Kontrol Et"
          icon={RefreshCw}
          loading={checking}
          onPress={() => void checkVerification()}
        />
        <AppButton
          label="E-posta Uygulamasını Aç"
          icon={ExternalLink}
          variant="secondary"
          onPress={() => void openEmailApp()}
        />
        <AppButton
          label={
            cooldown > 0
              ? `Tekrar Gönder (${cooldown} sn)`
              : 'Doğrulama E-postasını Tekrar Gönder'
          }
          icon={RotateCw}
          variant="ghost"
          disabled={cooldown > 0}
          loading={resending}
          onPress={() => void resend()}
        />
        <AppButton
          label="Ana Sayfaya Dön"
          icon={House}
          variant="ghost"
          onPress={goHome}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.successSoft,
  },
  content: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  icon: {
    width: 86,
    height: 86,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  steps: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepNumber: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  stepText: { flex: 1 },
  feedback: {
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  feedbackDanger: { backgroundColor: colors.dangerSoft },
  feedbackSuccess: { backgroundColor: colors.successSoft },
  actions: { gap: spacing.xs, marginTop: 'auto' },
});

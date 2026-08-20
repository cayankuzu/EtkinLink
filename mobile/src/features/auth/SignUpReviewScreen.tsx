import type { AuthStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText } from '@shared/components';
import { legalDocumentUrls } from '@shared/legal/documents';
import { toAppError } from '@shared/lib/errors';
import { isUsernameAvailable } from '@shared/lib/username';
import { colors, radius, spacing } from '@shared/theme';
import {
  Check,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  ShieldCheck,
} from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { signUp } from './authService';
import {
  clearPendingVerification,
  persistPendingVerification,
} from './pendingVerificationService';
import { useRegistrationDraftStore } from './registrationDraftStore';
import { RegistrationLayout } from './RegistrationLayout';
import {
  clearPendingRegistration,
  persistPendingRegistration,
} from './registrationService';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUpReview'>;

const documents = [
  { key: 'terms' as const, title: 'Kullanım Koşulları' },
  { key: 'privacy' as const, title: 'Gizlilik Politikası' },
  { key: 'kvkk' as const, title: 'KVKK Aydınlatma Metni' },
];

export function SignUpReviewScreen({ navigation }: Props) {
  const draft = useRegistrationDraftStore();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDocument(document: (typeof documents)[number]['key']) {
    try {
      await Linking.openURL(legalDocumentUrls[document]);
    } catch {
      Alert.alert(
        'Bağlantı açılamadı',
        'İnternet bağlantını kontrol edip tekrar dene.',
      );
    }
  }

  async function createAccount() {
    if (!accepted || !draft.basics || !draft.details || draft.photos.length < 3)
      return;
    setLoading(true);
    setError(null);
    try {
      const usernameAvailable = await isUsernameAvailable(
        draft.basics.username,
      );
      if (!usernameAvailable) {
        throw new Error(
          'Bu kullanıcı adı az önce alınmış. Önceki adıma dönüp başka bir kullanıcı adı seç.',
        );
      }
      await persistPendingRegistration();
      await persistPendingVerification(draft.email);
      await signUp(
        { email: draft.email, password: draft.password },
        {
          fullName: draft.basics.fullName,
          username: draft.basics.username,
          birthDate: draft.basics.birthDate.toISOString().slice(0, 10),
          gender: draft.basics.gender,
          city: draft.details.city,
          bio: draft.details.bio,
          interestIds: draft.details.interestIds,
        },
      );
      draft.markSubmitted();
      navigation.replace('EmailSent', { email: draft.email });
    } catch (submitError) {
      await clearPendingRegistration();
      await clearPendingVerification();
      const message = toAppError(submitError).message;
      setError(
        message.toLocaleLowerCase('tr-TR').includes('database')
          ? 'Kullanıcı adı veya e-posta adresi kullanılıyor. Bilgilerini kontrol edip tekrar dene.'
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  if (!draft.basics || !draft.details) {
    return (
      <RegistrationLayout
        step={5}
        title="Eksik bilgi var"
        description="Onay adımına geçmeden önce önceki adımları tamamlamalısın."
        icon={ClipboardCheck}
        onBack={navigation.goBack}
      >
        <AppButton label="Önceki Adıma Dön" onPress={navigation.goBack} />
      </RegistrationLayout>
    );
  }

  return (
    <RegistrationLayout
      step={5}
      title="Koşulları incele ve onayla"
      description="Hesabını oluşturmadan önce yasal metinleri okuyup onaylamalısın."
      icon={FileCheck2}
      onBack={navigation.goBack}
    >
      <View style={styles.documentList}>
        {documents.map((document, index) => (
          <Pressable
            key={document.key}
            accessibilityRole="link"
            accessibilityLabel={`${document.title} metnini aç`}
            onPress={() => void openDocument(document.key)}
            style={({ pressed }) => [
              styles.documentRow,
              index < documents.length - 1 && styles.documentBorder,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.documentIcon}>
              <FileText size={20} color={colors.brand} />
            </View>
            <AppText
              variant="label15"
              tone="brand"
              style={styles.documentTitle}
            >
              {document.title}
            </AppText>
            <ExternalLink size={19} color={colors.brand} />
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="Yasal metinleri kabul et"
        onPress={() => setAccepted(current => !current)}
        style={({ pressed }) => [styles.terms, pressed && styles.pressed]}
      >
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
          {accepted ? <Check size={15} color={colors.textInverse} /> : null}
        </View>
        <AppText variant="body14" tone="secondary" style={styles.termsText}>
          Kullanım Koşulları'nı, Gizlilik Politikası'nı ve KVKK Aydınlatma
          Metni'ni okudum; kabul ediyorum.
        </AppText>
      </Pressable>

      <View style={styles.emailNote}>
        <ShieldCheck size={20} color={colors.success} />
        <View style={styles.emailCopy}>
          <AppText variant="label14">Doğrulama e-postası</AppText>
          <AppText variant="caption12" tone="secondary">
            Hesabın bu son adımdan sonra oluşturulacak ve doğrulama bağlantısı{' '}
            {draft.email} adresine gönderilecek.
          </AppText>
        </View>
      </View>

      {error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}

      <AppButton
        label="Profili Oluştur ve E-posta Gönder"
        disabled={!accepted}
        loading={loading}
        onPress={() => void createAccount()}
      />
    </RegistrationLayout>
  );
}

const styles = StyleSheet.create({
  documentList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  documentRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  documentBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  documentIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  documentTitle: { flex: 1 },
  terms: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSoft,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  termsText: { flex: 1 },
  emailNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  emailCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.68 },
});

import type { ProfileStackParamList } from '@app/navigation/types';
import { sendPasswordReset } from '@features/auth/authService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, IconButton, Screen } from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing } from '@shared/theme';
import { ArrowLeft, MailCheck } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ChangePassword'>;

export function ChangePasswordScreen({ navigation }: Props) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) {
      setError('Hesabına bağlı e-posta bulunamadı.');
      setBusy(false);
      return;
    }
    try {
      await sendPasswordReset(data.user.email);
    } catch (sendError) {
      setError(toAppError(sendError).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    setSent(true);
  }
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20">Şifre yenile</AppText>
        <View style={styles.spacer} />
      </View>
      <View style={styles.card}>
        <View style={styles.icon}>
          <MailCheck size={32} color={colors.brand} />
        </View>
        <AppText variant="heading20" align="center">
          {sent ? 'Bağlantı gönderildi' : 'Güvenli şifre yenileme'}
        </AppText>
        <AppText tone="secondary" align="center">
          {sent
            ? 'E-postandaki tek kullanımlık bağlantıya dokunarak yeni şifreni belirleyebilirsin.'
            : 'Hesabındaki doğrulanmış e-posta adresine şifre yenileme bağlantısı gönderilecek.'}
        </AppText>
        {error ? (
          <AppText variant="caption12" tone="danger">
            {error}
          </AppText>
        ) : null}
        <AppButton
          label={sent ? 'Tekrar gönder' : 'Bağlantı gönder'}
          loading={busy}
          onPress={() => void send()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.xl },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: 48 },
  headerButton: { borderWidth: 0, backgroundColor: colors.transparent },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    gap: spacing.md,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
});

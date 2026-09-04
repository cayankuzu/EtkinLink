import type { MessagesStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppText, IconButton, Screen } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import {
  ArrowLeft,
  BellRing,
  CircleDot,
  Eye,
  LockKeyhole,
  MessageSquareText,
  Sparkles,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

type Props = NativeStackScreenProps<MessagesStackParamList, 'ChatSettings'>;

export function ChatSettingsScreen({ navigation }: Props) {
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="headingMd">Sohbet gizliliği</AppText>
        <View style={styles.spacer} />
      </View>

      <View style={styles.notice}>
        <View style={styles.noticeIcon}>
          <Sparkles size={22} color={colors.brand} />
        </View>
        <View style={styles.noticeText}>
          <AppText variant="label">Premium kontroller yakında</AppText>
          <AppText variant="caption" tone="secondary">
            Şimdilik tüm güvenli sohbet özellikleri açık ve değiştirilemez.
            Yakında Premium ile görünürlük tercihlerini
            kişiselleştirebileceksin.
          </AppText>
        </View>
        <LockKeyhole size={20} color={colors.textTertiary} />
      </View>

      <View style={styles.card}>
        <SettingRow
          icon={Eye}
          title="Okundu bilgisini paylaş"
          description="Gönderdiğin ve okunan mesajlarda okundu bilgisi gösterilir."
        />
        <SettingRow
          icon={CircleDot}
          title="Çevrimiçi durumunu paylaş"
          description="Uygulamayı kullandığın sürece eşleşmelerin seni çevrimiçi görür."
        />
        <SettingRow
          icon={MessageSquareText}
          title="Yazıyor bilgisini paylaş"
          description="Yazma bilgisi anlık iletilir ve kalıcı olarak saklanmaz."
        />
        <SettingRow
          icon={BellRing}
          title="Sohbet bildirimleri"
          description="Bu eşleşmeden gelen yeni mesajlar ve sohbet durumu değişiklikleri bildirilir."
          last
        />
      </View>

      <View style={styles.lockedHint}>
        <LockKeyhole size={16} color={colors.textTertiary} />
        <AppText variant="caption" tone="tertiary" style={styles.hintText}>
          Bu seçenekler varsayılan olarak açık tutulur. Anahtarlar Premium
          kontroller kullanıma açıldığında etkinleşecek.
        </AppText>
      </View>
    </Screen>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  last = false,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={styles.icon}>
        <Icon size={20} color={colors.brand} />
      </View>
      <View style={styles.rowText}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" tone="secondary">
          {description}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={`${title}, açık ve kilitli`}
        accessibilityState={{ checked: true, disabled: true }}
        value
        disabled
        trackColor={{ false: colors.borderStrong, true: colors.brandSoft }}
        thumbColor={colors.brand}
      />
    </View>
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
  notice: {
    borderWidth: 1,
    borderColor: colors.brandSoft,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeText: { flex: 1, gap: spacing.xxs },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: spacing.xxs },
  lockedHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  hintText: { flex: 1 },
});

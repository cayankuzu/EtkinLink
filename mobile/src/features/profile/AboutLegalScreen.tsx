import type { ProfileStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppText, IconButton, Screen } from '@shared/components';
import { legalDocumentUrls } from '@shared/legal/documents';
import { colors, radius, spacing } from '@shared/theme';
import { ArrowLeft, ExternalLink, FileText, Info } from 'lucide-react-native';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AboutLegal'>;

const documents = [
  { title: 'EtkinLink Hakkında', document: 'about' as const, icon: Info },
  { title: 'Kullanım Koşulları', document: 'terms' as const, icon: FileText },
  {
    title: 'Gizlilik Politikası',
    document: 'privacy' as const,
    icon: FileText,
  },
  { title: 'KVKK Aydınlatma Metni', document: 'kvkk' as const, icon: FileText },
  {
    title: 'Topluluk Kuralları',
    document: 'community' as const,
    icon: FileText,
  },
  {
    title: 'Çocuk Güvenliği Politikası',
    document: 'childSafety' as const,
    icon: FileText,
  },
  {
    title: 'Hesap ve Veri Silme',
    document: 'accountDeletion' as const,
    icon: FileText,
  },
];

export function AboutLegalScreen({ navigation }: Props) {
  async function openDocument(
    document: (typeof documents)[number]['document'],
  ) {
    try {
      await Linking.openURL(legalDocumentUrls[document]);
    } catch {
      Alert.alert(
        'Bağlantı açılamadı',
        'İnternet bağlantını kontrol edip tekrar dene.',
      );
    }
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
        <AppText variant="heading20">Hakkında ve Yasal</AppText>
        <View style={styles.spacer} />
      </View>
      <View style={styles.card}>
        {documents.map((item, index) => {
          const Icon = item.icon;
          return (
            <Pressable
              key={item.document}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={() => void openDocument(item.document)}
              style={({ pressed }) => [
                styles.row,
                index < documents.length - 1 && styles.rowBorder,
                pressed && styles.pressed,
              ]}
            >
              <Icon size={20} color={colors.textSecondary} />
              <AppText variant="label15" style={styles.rowText}>
                {item.title}
              </AppText>
              <ExternalLink size={19} color={colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
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
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1 },
  pressed: { opacity: 0.7 },
});

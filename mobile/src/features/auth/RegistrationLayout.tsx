import { AppText, IconButton, Screen } from '@shared/components';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import { ArrowLeft } from 'lucide-react-native';
import type { ComponentType, PropsWithChildren } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const appSymbol = require('../../assets/images/etkinlink-symbol.png');

type Props = PropsWithChildren<{
  step: 2 | 3 | 4 | 5;
  title: string;
  description: string;
  icon: ComponentType<LucideProps>;
  onBack: () => void;
}>;

export function RegistrationLayout({
  step,
  title,
  description,
  icon: Icon,
  onBack,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Screen
      scroll
      contentStyle={[
        styles.screen,
        { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md) },
      ]}
    >
      <View style={styles.topBar}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={onBack}
          style={styles.back}
        />
        <View style={styles.brand} accessibilityRole="header">
          <Image
            source={appSymbol}
            style={styles.brandImage}
            resizeMode="contain"
          />
          <AppText variant="label15" tone="brand">
            EtkinLink
          </AppText>
        </View>
        <View style={styles.spacer} />
      </View>

      <View style={styles.progressMeta}>
        <AppText variant="caption12" tone="brand">
          ADIM {step} / 5
        </AppText>
        <AppText variant="caption12" tone="secondary">
          %{step * 20} tamamlandı
        </AppText>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${step * 20}%` }]} />
      </View>

      <View style={styles.intro}>
        <View style={styles.introIcon}>
          <Icon size={24} color={colors.brand} strokeWidth={2.2} />
        </View>
        <View style={styles.introCopy}>
          <AppText variant="heading24">{title}</AppText>
          <AppText variant="body14" tone="secondary">
            {description}
          </AppText>
        </View>
      </View>

      <View style={styles.card}>{children}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    gap: spacing.md,
    backgroundColor: colors.brandSubtle,
  },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brand: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  brandImage: { width: 30, height: 30, borderRadius: radius.sm },
  spacer: { width: 48 },
  progressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  intro: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  introIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandSoft,
  },
  introCopy: { flex: 1, gap: spacing.xxs },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
});

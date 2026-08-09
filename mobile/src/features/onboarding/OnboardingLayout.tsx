import { AppText, Screen } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

type OnboardingLayoutProps = PropsWithChildren<{
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  description: string;
  scroll?: boolean;
}>;

export function OnboardingLayout({
  step,
  title,
  description,
  scroll = true,
  children,
}: OnboardingLayoutProps) {
  return (
    <Screen scroll={scroll} contentStyle={styles.screen}>
      <View style={styles.progressHeader}>
        <AppText variant="caption12" tone="brand">
          ADIM {step} / 5
        </AppText>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, progressWidths[step]]} />
        </View>
      </View>
      <View style={styles.intro}>
        <AppText variant="heading24">{title}</AppText>
        <AppText tone="secondary">{description}</AppText>
      </View>
      <View style={styles.content}>{children}</View>
    </Screen>
  );
}

const progressWidths = StyleSheet.create({
  1: { width: '20%' },
  2: { width: '40%' },
  3: { width: '60%' },
  4: { width: '80%' },
  5: { width: '100%' },
});
const styles = StyleSheet.create({
  screen: { padding: spacing.xl, gap: spacing.xl },
  progressHeader: { gap: spacing.xs, paddingTop: spacing.sm },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  intro: { gap: spacing.xs },
  content: { gap: spacing.md, flexGrow: 1 },
});

import { AppText, IconButton, Screen } from '@shared/components';
import { colors, radius, shadows, spacing } from '@shared/theme';
import { ArrowLeft } from 'lucide-react-native';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AuthLayoutProps = PropsWithChildren<{
  title: string;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
  onBack?: () => void;
  presentation?: 'standard' | 'heroCard';
}>;

const appSymbol = require('../../assets/images/etkinlink-symbol.png');

export function AuthLayout({
  title,
  description,
  eyebrow,
  footer,
  onBack,
  presentation = 'standard',
  children,
}: AuthLayoutProps) {
  const isHeroCard = presentation === 'heroCard';
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboard}
    >
      <Screen
        scroll
        keyboardShouldPersistTaps="handled"
        contentStyle={[
          styles.screen,
          isHeroCard && styles.heroScreen,
          isHeroCard && {
            paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.sm),
          },
        ]}
      >
        {isHeroCard ? (
          <>
            <View style={styles.orbLarge} pointerEvents="none" />
            <View style={styles.orbSmall} pointerEvents="none" />
          </>
        ) : null}

        <View style={[styles.header, isHeroCard && styles.heroHeader]}>
          {onBack ? (
            <IconButton
              icon={ArrowLeft}
              label="Geri"
              onPress={onBack}
              style={styles.back}
            />
          ) : (
            <View style={styles.spacer} />
          )}

          {isHeroCard ? (
            <View style={styles.brandLockup} accessibilityRole="header">
              <View style={styles.brandMark}>
                <Image
                  source={appSymbol}
                  style={styles.brandImage}
                  resizeMode="contain"
                />
              </View>
              <AppText variant="label15" tone="brand">
                EtkinLink
              </AppText>
            </View>
          ) : (
            <AppText variant="heading18" style={styles.standardTitle}>
              {title}
            </AppText>
          )}
          <View style={styles.spacer} />
        </View>

        {isHeroCard ? (
          <View style={styles.heroCopy} accessible accessibilityRole="header">
            {eyebrow ? (
              <View style={styles.eyebrowBadge}>
                <View style={styles.eyebrowDot} />
                <AppText variant="caption12" tone="brand">
                  {eyebrow}
                </AppText>
              </View>
            ) : null}
            <AppText variant="display" style={styles.heroTitle}>
              {title}
            </AppText>
            {description ? (
              <AppText
                variant="body15"
                tone="secondary"
                style={styles.description}
              >
                {description}
              </AppText>
            ) : null}
          </View>
        ) : description ? (
          <AppText variant="caption12" tone="secondary">
            {description}
          </AppText>
        ) : null}

        <View style={[styles.form, isHeroCard && styles.formCard]}>
          {children}
        </View>
        {footer ? (
          <View style={[styles.footer, isHeroCard && styles.heroFooter]}>
            {footer}
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1, backgroundColor: colors.canvas },
  screen: { padding: spacing.md, gap: spacing.md },
  heroScreen: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.brandSubtle,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 230,
    height: 230,
    top: -130,
    right: -105,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
  },
  orbSmall: {
    position: 'absolute',
    width: 88,
    height: 88,
    top: 160,
    left: -58,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroHeader: { marginBottom: spacing.xs },
  back: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brandLockup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandImage: { width: 30, height: 30, borderRadius: radius.sm },
  standardTitle: { flex: 1, marginLeft: spacing.sm },
  spacer: { width: 44 },
  heroCopy: { gap: spacing.xs, paddingVertical: spacing.sm },
  eyebrowBadge: {
    alignSelf: 'flex-start',
    minHeight: 28,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.brandSoft,
  },
  eyebrowDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  heroTitle: { maxWidth: 320, letterSpacing: -0.7 },
  description: { maxWidth: 340 },
  form: { flexGrow: 1, gap: spacing.sm },
  formCard: {
    flexGrow: 0,
    marginTop: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  footer: { alignItems: 'center', paddingBottom: spacing.sm },
  heroFooter: { paddingTop: spacing.xs, paddingBottom: 0 },
});

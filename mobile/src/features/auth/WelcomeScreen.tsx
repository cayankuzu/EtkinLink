import type { AuthStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, Screen } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import { Compass, ShieldAlert, Users } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const illustration = require('../../assets/images/welcome-illustration.png');

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.upperContent}>
        <View style={styles.hero}>
          <Image
            source={illustration}
            style={styles.illustration}
            resizeMode="cover"
            accessibilityRole="image"
            accessibilityLabel="Bir etkinlikte birlikte sosyalleşen insanlar"
          />
        </View>

        <View style={styles.body}>
          <View style={styles.titleBlock}>
            <AppText variant="heading22">EtkinLink'e Hoş Geldin</AppText>
            <AppText variant="body14" tone="secondary">
              Etkinlik etrafında güvenli sosyalleşme ve eşleşme platformuna adım
              at.
            </AppText>
          </View>

          <View style={styles.highlights}>
            <Highlight
              icon={Compass}
              title="Etkinlikleri Keşfet"
              description="Şehrindeki en popüler konser, sergi ve atölyeleri anında bul."
            />
            <Highlight
              icon={ShieldAlert}
              title="Güvenli Sosyalleşme"
              description="Sadece onaylı profiller ve topluluk kurallarıyla korunan güvenli ortam."
            />
            <Highlight
              icon={Users}
              title="Eşleşme ve Sohbet"
              description="Benzer ilgi alanlarına sahip insanlarla etkinlik öncesi odalarda eşleş."
            />
          </View>
        </View>
      </View>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
      >
        <AppButton
          label="Giriş Yap"
          testID="welcome-sign-in"
          onPress={() => navigation.navigate('SignIn')}
        />
        <AppButton
          label="Hesap Oluştur"
          testID="welcome-sign-up"
          variant="secondary"
          onPress={() => navigation.navigate('SignUp')}
        />
      </View>
    </Screen>
  );
}

function Highlight({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
}) {
  return (
    <View style={styles.highlight}>
      <View style={styles.highlightIcon}>
        <Icon size={20} color={colors.brand} />
      </View>
      <View style={styles.highlightText}>
        <AppText variant="label15">{title}</AppText>
        <AppText variant="caption12" tone="secondary">
          {description}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'space-between' },
  upperContent: { flexShrink: 1 },
  hero: { height: 220, padding: spacing.md },
  illustration: {
    width: '100%',
    height: '100%',
    borderRadius: radius.lg,
  },
  body: {
    gap: spacing.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  titleBlock: { gap: spacing.xs },
  highlights: { gap: spacing.md },
  highlight: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  highlightIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightText: { flex: 1, gap: 2 },
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});

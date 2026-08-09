import type { OnboardingStackParamList } from '@app/navigation/types';
import { useSessionStore } from '@features/auth/sessionStore';
import { getProfile } from '@features/profile/profileService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, Skeleton } from '@shared/components';
import { legalDocumentUrls } from '@shared/legal/documents';
import { colors, radius, spacing } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { Check, Square } from 'lucide-react-native';
import { useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { OnboardingLayout } from './OnboardingLayout';
import { completeOnboarding } from './onboardingService';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Complete'>;

export function CompleteOnboardingScreen(_props: Props) {
  const refreshProfile = useSessionStore(state => state.refreshProfile);
  const [accepted, setAccepted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ['profile', 'current'],
    queryFn: () => getProfile(),
  });

  async function openLegalUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        'Bağlantı açılamadı',
        'İnternet bağlantını kontrol edip tekrar dene.',
      );
    }
  }

  async function finish() {
    if (!accepted) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await completeOnboarding();
      await refreshProfile();
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : 'Profil yayınlanamadı.',
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <OnboardingLayout
      step={5}
      title="Profilini kontrol et"
      description="E-posta adresin hariç aşağıdaki bilgiler etkinlik profillerinde görünür."
    >
      {profile.isLoading ? (
        <>
          <Skeleton style={styles.photosSkeleton} />
          <Skeleton style={styles.cardSkeleton} />
        </>
      ) : profile.data ? (
        <>
          <View style={styles.photoHeader}>
            <AppText variant="caption12" tone="brand">
              {profile.data.photos.length} / 6 fotoğraf
            </AppText>
            <AppText variant="caption12" tone="secondary">
              En az 3 · En fazla 6
            </AppText>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photos}
          >
            {profile.data.photos.map((photo, index) => (
              <View key={photo.id} style={styles.photoWrap}>
                <Image source={{ uri: photo.url }} style={styles.photo} />
                {index === 0 ? (
                  <View style={styles.coverBadge}>
                    <AppText variant="tiny11" tone="inverse">
                      Kapak
                    </AppText>
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>

          <View style={styles.profileCard}>
            <AppText variant="heading18">{profile.data.fullName}</AppText>
            <AppText variant="caption12" tone="secondary">
              @{profile.data.username}
            </AppText>
            <AppText variant="caption12" tone="brand">
              {[
                profile.data.age !== null ? `${profile.data.age} yaş` : null,
                profile.data.city,
              ]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
            <AppText variant="body14" tone="secondary">
              {profile.data.bio}
            </AppText>
            <AppText variant="caption12" tone="brand">
              {profile.data.interests.map(item => item.label).join('  ·  ')}
            </AppText>
          </View>
        </>
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={() => setAccepted(current => !current)}
        style={styles.terms}
      >
        {accepted ? (
          <Check size={20} color={colors.brand} />
        ) : (
          <Square size={20} color={colors.textSecondary} />
        )}
        <AppText variant="tiny11" tone="secondary" style={styles.termsText}>
          KVKK, Kullanım Koşulları ve Topluluk Kurallarını okudum, kabul
          ediyorum.
        </AppText>
      </Pressable>

      <View style={styles.legalLinks}>
        <Pressable onPress={() => void openLegalUrl(legalDocumentUrls.kvkk)}>
          <AppText variant="caption12" tone="brand">
            KVKK
          </AppText>
        </Pressable>
        <Pressable onPress={() => void openLegalUrl(legalDocumentUrls.terms)}>
          <AppText variant="caption12" tone="brand">
            Kullanım Koşulları
          </AppText>
        </Pressable>
        <Pressable
          onPress={() => void openLegalUrl(legalDocumentUrls.community)}
        >
          <AppText variant="caption12" tone="brand">
            Topluluk Kuralları
          </AppText>
        </Pressable>
      </View>

      <AppButton
        label="Profili Yayınla"
        loading={publishing}
        disabled={!accepted || !profile.data}
        onPress={() => void finish()}
      />
      {publishError ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {publishError}
        </AppText>
      ) : null}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  photoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photos: { gap: spacing.xs },
  photoWrap: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  coverBadge: {
    position: 'absolute',
    left: 5,
    bottom: 5,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  profileCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  terms: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  termsText: { flex: 1 },
  legalLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  photosSkeleton: { height: 96 },
  cardSkeleton: { height: 180 },
});

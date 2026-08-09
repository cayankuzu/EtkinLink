import type { OnboardingStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppText, IconButton } from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { colors, radius, spacing } from '@shared/theme';
import { ImagePlus, Star, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import { OnboardingLayout } from './OnboardingLayout';
import { type LocalPhoto, uploadProfilePhotos } from './onboardingService';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Photos'>;

function extensionForMime(mime: string | undefined): LocalPhoto['extension'] {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  return 'jpg';
}

export function PhotosScreen({ navigation }: Props) {
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPhotos() {
    const remaining = 6 - photos.length;
    if (remaining <= 0) return;
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: remaining,
      includeBase64: true,
      quality: 0.8,
      maxWidth: 1600,
      maxHeight: 1600,
    });
    if (result.didCancel) return;
    if (result.errorCode) {
      setError('Fotoğraflar seçilemedi. Lütfen tekrar dene.');
      return;
    }
    const valid = (result.assets ?? []).flatMap(asset =>
      asset.uri && asset.base64
        ? [
            {
              id: createClientId(),
              uri: asset.uri,
              base64: asset.base64,
              mimeType: asset.type ?? 'image/jpeg',
              extension: extensionForMime(asset.type),
            },
          ]
        : [],
    );
    setPhotos(current => [...current, ...valid].slice(0, 6));
  }

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await uploadProfilePhotos(photos);
      navigation.navigate('Complete');
    } catch (uploadError) {
      setError(toAppError(uploadError).message);
    } finally {
      setLoading(false);
    }
  }

  function makePrimary(index: number) {
    setPhotos(current => {
      const next = [...current];
      const selected = next.splice(index, 1)[0];
      return selected ? [selected, ...next] : current;
    });
  }

  return (
    <OnboardingLayout
      step={4}
      title="Fotoğraflarını ekle"
      description="Eşleşmeye katılmak için en az 3, en fazla 6 fotoğraf gerekir. İlk fotoğraf profil kartının ana fotoğrafıdır."
    >
      <AppText
        variant="caption12"
        tone={photos.length >= 3 ? 'success' : 'secondary'}
      >
        {photos.length} / 6 fotoğraf
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.grid}
      >
        {photos.map((photo, index) => (
          <View key={photo.id} style={styles.photoWrap}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.photo}
              accessibilityLabel={`Profil fotoğrafı ${index + 1}`}
            />
            {index === 0 ? (
              <View style={styles.primaryBadge}>
                <Star
                  size={12}
                  color={colors.textInverse}
                  fill={colors.textInverse}
                />
                <AppText variant="tiny11" tone="inverse">
                  Kapak
                </AppText>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. fotoğrafı ana fotoğraf yap`}
                onPress={() => makePrimary(index)}
                style={styles.makePrimary}
              >
                <Star size={18} color={colors.textInverse} />
              </Pressable>
            )}
            <IconButton
              icon={Trash2}
              label={`${index + 1}. fotoğrafı kaldır`}
              danger
              onPress={() =>
                setPhotos(current =>
                  current.filter(item => item.id !== photo.id),
                )
              }
              style={styles.remove}
            />
          </View>
        ))}
        {photos.length < 6 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf ekle"
            onPress={() => void addPhotos()}
            style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          >
            <ImagePlus size={30} color={colors.brand} />
            <AppText variant="label14" tone="brand">
              Fotoğraf ekle
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
      <AppText variant="caption12" tone="secondary">
        Yüzünün net göründüğü, güncel ve yalnızca sana ait fotoğraflar kullan.
        Uygunsuz içerikler uyarı ve hesap kısıtlamasıyla sonuçlanabilir.
      </AppText>
      {error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <AppButton
        label="Profili önizle"
        disabled={photos.length < 3}
        loading={loading}
        onPress={() => void submit()}
      />
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.xs },
  photoWrap: {
    width: 104,
    height: 104,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  primaryBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  makePrimary: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
  },
  add: {
    width: 104,
    height: 104,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addPressed: { opacity: 0.7 },
});

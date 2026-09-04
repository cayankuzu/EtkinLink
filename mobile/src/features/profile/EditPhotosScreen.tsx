import type { ProfileStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppImage,
  AppText,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, radius, spacing } from '@shared/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Star, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

import {
  getProfile,
  type ReplacementPhoto,
  replaceProfilePhotos,
} from './profileService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditPhotos'>;
type EditablePhoto = ReplacementPhoto & { id: string; uri: string };

function extensionForMime(
  mime: string | undefined,
): 'jpg' | 'png' | 'webp' | 'heic' | 'heif' {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  return 'jpg';
}

export function EditPhotosScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<EditablePhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: queryKeys.profile.current,
    queryFn: () => getProfile(),
  });
  useEffect(() => {
    if (!profile.data || photos.length) return;
    setPhotos(
      profile.data.photos.map(photo => ({
        kind: 'existing',
        id: photo.id,
        uri: photo.url,
        storagePath: photo.storagePath,
      })),
    );
  }, [photos.length, profile.data]);
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
    const selected: EditablePhoto[] = (result.assets ?? []).flatMap(asset =>
      asset.uri && asset.base64
        ? [
            {
              kind: 'new' as const,
              id: createClientId(),
              uri: asset.uri,
              base64: asset.base64,
              mimeType: asset.type ?? 'image/jpeg',
              extension: extensionForMime(asset.type),
            },
          ]
        : [],
    );
    setPhotos(current => [...current, ...selected].slice(0, 6));
  }
  function makePrimary(index: number) {
    setPhotos(current => {
      const next = [...current];
      const selected = next.splice(index, 1)[0];
      return selected ? [selected, ...next] : current;
    });
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await replaceProfilePhotos(photos);
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      navigation.goBack();
    } catch (saveError) {
      setError(toAppError(saveError).message);
    } finally {
      setBusy(false);
    }
  }
  if (profile.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  if (profile.isError)
    return (
      <Screen>
        <ErrorState
          title="Fotoğraflar yüklenemedi"
          description={toAppError(profile.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="headingMd">Fotoğrafları düzenle</AppText>
        <View style={styles.spacer} />
      </View>
      <AppText
        variant="caption"
        tone={photos.length >= 3 ? 'success' : 'secondary'}
      >
        {photos.length}/6 fotoğraf · En az 3 fotoğraf
      </AppText>
      <View style={styles.grid}>
        {photos.map((photo, index) => (
          <View key={photo.id} style={styles.photoWrap}>
            <AppImage
              uri={photo.uri}
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
                <AppText variant="caption" tone="inverse">
                  Ana fotoğraf
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
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <ImagePlus size={30} color={colors.brand} />
            <AppText variant="labelSm" tone="brand">
              Fotoğraf ekle
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <AppText variant="caption" tone="secondary">
        İlk kare ana fotoğrafındır. Sıralamak için diğer fotoğraflardaki yıldız
        düğmesini kullan.
      </AppText>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <AppButton
        label="Fotoğrafları kaydet"
        disabled={photos.length < 3}
        loading={busy}
        onPress={() => void save()}
      />
    </Screen>
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoWrap: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  primaryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
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
    width: 40,
    height: 40,
    borderRadius: 20,
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
    width: '47%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  skeleton: { width: '47%', aspectRatio: 1 },
});

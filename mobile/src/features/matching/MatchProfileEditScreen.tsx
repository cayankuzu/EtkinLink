import type { RoomsStackParamList } from '@app/navigation/types';
import {
  listInterests,
  saveInterests,
} from '@features/onboarding/onboardingService';
import {
  getProfile,
  type ReplacementPhoto,
  replaceProfilePhotos,
} from '@features/profile/profileService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  ErrorState,
  IconButton,
  Screen,
  Skeleton,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { createClientId } from '@shared/lib/ids';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing } from '@shared/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ImagePlus, Star, Trash2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';

type Props = NativeStackScreenProps<RoomsStackParamList, 'MatchProfileEdit'>;
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

export function MatchProfileEditScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [photos, setPhotos] = useState<EditablePhoto[]>([]);
  const [bio, setBio] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [interestsVisible, setInterestsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ['profile', 'current'],
    queryFn: () => getProfile(),
  });
  const interests = useQuery({
    queryKey: ['interests'],
    queryFn: listInterests,
    staleTime: 24 * 60 * 60_000,
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
    setBio(profile.data.bio);
    setSelected(profile.data.interests.map(item => item.id));
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
    const next: EditablePhoto[] = (result.assets ?? []).flatMap(asset =>
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
    setPhotos(current => [...current, ...next].slice(0, 6));
  }

  function makePrimary(index: number) {
    setPhotos(current => {
      const next = [...current];
      const primary = next.splice(index, 1)[0];
      return primary ? [primary, ...next] : current;
    });
  }

  function toggleInterest(id: string) {
    setSelected(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : current.length < 12
        ? [...current, id]
        : current,
    );
  }

  async function save() {
    if (photos.length < 3) {
      setError('Eşleşme için en az 3 fotoğraf gerekir.');
      return;
    }
    if (bio.trim().length < 20) {
      setError('Biyografi en az 20 karakter olmalı.');
      return;
    }
    if (selected.length < 3) {
      setError('En az 3 ilgi alanı seçmelisin.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user)
        throw authError ?? new Error('Oturum gerekli.');
      await replaceProfilePhotos(photos);
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ bio: bio.trim() })
        .eq('id', auth.user.id);
      if (profileError) throw profileError;
      await saveInterests(selected);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['matching-settings'] }),
      ]);
      navigation.goBack();
    } catch (saveError) {
      setError(toAppError(saveError).message);
    } finally {
      setBusy(false);
    }
  }

  if (profile.isLoading || interests.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.photoSkeleton} />
        <Skeleton style={styles.formSkeleton} />
      </Screen>
    );
  if (profile.isError || interests.isError)
    return (
      <Screen>
        <ErrorState
          title="Eşleşme profili açılamadı"
          description={toAppError(profile.error ?? interests.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );

  const selectedInterests = (interests.data ?? []).filter(item =>
    selected.includes(item.id),
  );
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading18">Eşleşme Profili</AppText>
      </View>
      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="label13">Fotoğraflar (3–6)</AppText>
          <AppText
            variant="caption12"
            tone={photos.length >= 3 ? 'success' : 'danger'}
          >
            {photos.length}/6
          </AppText>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photos}
        >
          {photos.map((photo, index) => (
            <View key={photo.id} style={styles.photoWrap}>
              <Image source={{ uri: photo.uri }} style={styles.photo} />
              {index === 0 ? (
                <View style={styles.primaryBadge}>
                  <Star
                    size={11}
                    color={colors.textInverse}
                    fill={colors.textInverse}
                  />
                  <AppText variant="tiny11" tone="inverse">
                    Kapak
                  </AppText>
                </View>
              ) : (
                <IconButton
                  icon={Star}
                  label={`${index + 1}. fotoğrafı kapak yap`}
                  onPress={() => makePrimary(index)}
                  style={styles.photoAction}
                />
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
                style={styles.removeAction}
              />
            </View>
          ))}
          {photos.length < 6 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fotoğraf ekle"
              onPress={() => void addPhotos()}
              style={styles.addPhoto}
            >
              <ImagePlus size={24} color={colors.brand} />
              <AppText variant="caption12" tone="brand" align="center">
                Fotoğraf ekle
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
      <TextField
        label="Biyografi"
        value={bio}
        onChangeText={setBio}
        multiline
        numberOfLines={4}
        maxLength={contentLimits.bio}
      />
      <View style={styles.section}>
        <AppText variant="label13">İlgi Alanları</AppText>
        <View style={styles.chips}>
          {selectedInterests.map(item => (
            <Chip
              key={item.id}
              label={item.label}
              selected
              onPress={() => toggleInterest(item.id)}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="İlgi alanı ekle"
            onPress={() => setInterestsVisible(true)}
            style={styles.addInterest}
          >
            <ImagePlus size={14} color={colors.brand} />
            <AppText variant="caption12" tone="brand">
              İlgi alanı ekle
            </AppText>
          </Pressable>
        </View>
      </View>
      {error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <AppButton label="Kaydet" loading={busy} onPress={() => void save()} />
      <Modal
        visible={interestsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setInterestsVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.interestSheet}>
            <View style={styles.sheetHeader}>
              <View>
                <AppText variant="heading18">İlgi Alanları</AppText>
                <AppText variant="caption12" tone="secondary">
                  {selected.length}/12 seçildi · En az 3
                </AppText>
              </View>
              <IconButton
                icon={X}
                label="İlgi alanlarını kapat"
                onPress={() => setInterestsVisible(false)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.allChips}>
              {(interests.data ?? []).map(item => (
                <Chip
                  key={item.id}
                  label={item.label}
                  selected={selected.includes(item.id)}
                  onPress={() => toggleInterest(item.id)}
                />
              ))}
            </ScrollView>
            <AppButton
              label="Tamam"
              onPress={() => setInterestsVisible(false)}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  section: { gap: spacing.sm },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  photos: { gap: spacing.sm },
  photoWrap: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  primaryBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
    paddingHorizontal: 7,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  photoAction: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: 36,
    height: 36,
    backgroundColor: colors.surface,
  },
  removeAction: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 36,
    height: 36,
    backgroundColor: colors.surface,
  },
  addPhoto: {
    width: 104,
    height: 104,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  addInterest: {
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  interestSheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  allChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  photoSkeleton: { height: 104, borderRadius: radius.md },
  formSkeleton: { height: 280, borderRadius: radius.lg },
});

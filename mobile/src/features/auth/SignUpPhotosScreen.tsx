import type { AuthStackParamList } from '@app/navigation/types';
import type { LocalPhoto } from '@features/onboarding/onboardingService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppButton, AppImage, AppText, IconButton } from '@shared/components';
import { createClientId } from '@shared/lib/ids';
import { colors, radius, shadows, spacing } from '@shared/theme';
import {
  Camera,
  Check,
  ImagePlus,
  Images,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  type Asset,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';

import { useRegistrationDraftStore } from './registrationDraftStore';
import { RegistrationLayout } from './RegistrationLayout';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUpPhotos'>;

function extensionForMime(mime: string | undefined): LocalPhoto['extension'] {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic') return 'heic';
  if (mime === 'image/heif') return 'heif';
  return 'jpg';
}

function toLocalPhotos(assets: Asset[]): LocalPhoto[] {
  return assets.flatMap(asset =>
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
}

export function SignUpPhotosScreen({ navigation }: Props) {
  const savedPhotos = useRegistrationDraftStore(state => state.photos);
  const savePhotos = useRegistrationDraftStore(state => state.setPhotos);
  const [photos, setPhotos] = useState<LocalPhoto[]>(savedPhotos);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [preview, setPreview] = useState<LocalPhoto | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ignoreNextPress = useRef(false);

  function updatePhotos(next: LocalPhoto[]) {
    setPhotos(next);
    savePhotos(next);
    setSelectedIndex(null);
  }

  async function addPhotos(source: 'camera' | 'gallery') {
    const remaining = 6 - photos.length;
    if (remaining <= 0) return;
    setSourceOpen(false);
    const options = {
      mediaType: 'photo' as const,
      includeBase64: true,
      quality: 0.8 as const,
      maxWidth: 1600,
      maxHeight: 1600,
    };
    const result =
      source === 'camera'
        ? await launchCamera({ ...options, saveToPhotos: false })
        : await launchImageLibrary({
            ...options,
            selectionLimit: remaining,
          });
    if (result.didCancel) return;
    if (result.errorCode) {
      setError(
        source === 'camera'
          ? 'Kamera açılamadı. İzinleri kontrol edip tekrar dene.'
          : 'Fotoğraflar seçilemedi. Lütfen tekrar dene.',
      );
      return;
    }
    const next = toLocalPhotos(result.assets ?? []);
    if (!next.length) {
      setError('Fotoğraf işlenemedi. Farklı bir görsel deneyebilirsin.');
      return;
    }
    updatePhotos([...photos, ...next].slice(0, 6));
    setError(null);
  }

  function handlePhotoPress(index: number) {
    if (ignoreNextPress.current) {
      ignoreNextPress.current = false;
      return;
    }
    if (selectedIndex === null) {
      setPreview(photos[index] ?? null);
      return;
    }
    if (selectedIndex === index) {
      setSelectedIndex(null);
      return;
    }
    const next = [...photos];
    const selectedPhoto = next[selectedIndex];
    const targetPhoto = next[index];
    if (!selectedPhoto || !targetPhoto) return;
    next[selectedIndex] = targetPhoto;
    next[index] = selectedPhoto;
    updatePhotos(next);
  }

  function selectForSwap(index: number) {
    ignoreNextPress.current = true;
    setSelectedIndex(index);
  }

  return (
    <RegistrationLayout
      step={4}
      title="Fotoğraflarını ekle"
      description="En az 3, en fazla 6 güncel fotoğraf ekle. Sıralamayı kolayca değiştirebilirsin."
      icon={Images}
      onBack={navigation.goBack}
    >
      <View style={styles.counterRow}>
        <AppText variant="label14">Profil fotoğrafları</AppText>
        <View
          style={[styles.counter, photos.length >= 3 && styles.counterReady]}
        >
          <AppText
            variant="caption12"
            tone={photos.length >= 3 ? 'success' : 'brand'}
          >
            {photos.length} / 6
          </AppText>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photos}
      >
        {photos.map((photo, index) => {
          const selected = selectedIndex === index;
          return (
            <View
              key={photo.id}
              style={[styles.photoWrap, selected && styles.photoSelected]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${index + 1}. profil fotoğrafı`}
                accessibilityHint="Büyütmek için dokun; yerini değiştirmek için yarım saniye basılı tut."
                delayLongPress={500}
                onLongPress={() => selectForSwap(index)}
                onPress={() => handlePhotoPress(index)}
                style={styles.photoPressable}
              >
                <AppImage uri={photo.uri} style={styles.photo} />
                {selected ? (
                  <View style={styles.selectedBadge}>
                    <Check size={14} color={colors.textInverse} />
                    <AppText variant="tiny11" tone="inverse">
                      Seçildi
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
              <IconButton
                icon={Trash2}
                label={`${index + 1}. fotoğrafı kaldır`}
                danger
                onPress={() =>
                  updatePhotos(photos.filter(item => item.id !== photo.id))
                }
                style={styles.remove}
              />
            </View>
          );
        })}
        {photos.length < 6 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf ekle"
            onPress={() => setSourceOpen(true)}
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <View style={styles.addIcon}>
              <ImagePlus size={28} color={colors.brand} />
            </View>
            <AppText variant="label14" tone="brand" align="center">
              Fotoğraf ekle
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>

      {selectedIndex !== null ? (
        <View style={styles.swapNote} accessibilityLiveRegion="polite">
          <Check size={18} color={colors.brand} />
          <AppText variant="caption12" tone="brand" style={styles.noteText}>
            Fotoğraf seçildi. Yer değiştirmek istediğin diğer fotoğrafa dokun.
          </AppText>
        </View>
      ) : null}

      <View style={styles.safetyNote}>
        <ShieldCheck size={19} color={colors.success} />
        <AppText variant="caption12" tone="secondary" style={styles.noteText}>
          İlk fotoğraf profilinin kapak görselidir. Fotoğrafa dokunarak büyüt;
          0,5 saniye basılı tutup başka bir fotoğrafa dokunarak yerini değiştir.
        </AppText>
      </View>
      {error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {error}
        </AppText>
      ) : null}
      <AppButton
        label="Onay Adımına Geç"
        disabled={photos.length < 3}
        onPress={() => navigation.navigate('SignUpReview')}
      />

      <Modal
        animationType="fade"
        transparent
        visible={sourceOpen}
        onRequestClose={() => setSourceOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fotoğraf kaynağı seçimini kapat"
          style={styles.modalBackdrop}
          onPress={() => setSourceOpen(false)}
        >
          {/* A Pressable is an accessibility element by default, which would
              collapse the whole sheet into one VoiceOver node and hide the
              options inside it. This one only blocks backdrop taps. */}
          <Pressable
            accessible={false}
            accessibilityViewIsModal
            style={styles.sourceSheet}
            onPress={event => event.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <AppText variant="heading20">Fotoğraf ekle</AppText>
            <AppText variant="body14" tone="secondary">
              Yeni bir fotoğraf çekebilir veya galerinden seçebilirsin.
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => void addPhotos('camera')}
              style={({ pressed }) => [
                styles.sourceOption,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.sourceIcon}>
                <Camera size={23} color={colors.brand} />
              </View>
              <View style={styles.optionCopy}>
                <AppText variant="label15">Kamerayı aç</AppText>
                <AppText variant="caption12" tone="secondary">
                  Şimdi yeni bir fotoğraf çek
                </AppText>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void addPhotos('gallery')}
              style={({ pressed }) => [
                styles.sourceOption,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.sourceIcon}>
                <Images size={23} color={colors.brand} />
              </View>
              <View style={styles.optionCopy}>
                <AppText variant="label15">Galeriden yükle</AppText>
                <AppText variant="caption12" tone="secondary">
                  Cihazındaki fotoğraflardan seç
                </AppText>
              </View>
            </Pressable>
            <AppButton
              label="Vazgeç"
              variant="secondary"
              onPress={() => setSourceOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(preview)}
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.previewBackdrop}>
          <IconButton
            icon={X}
            label="Fotoğraf önizlemesini kapat"
            onPress={() => setPreview(null)}
            style={styles.previewClose}
          />
          {preview ? (
            <AppImage
              uri={preview.uri}
              style={styles.previewImage}
              fit="contain"
            />
          ) : null}
        </View>
      </Modal>
    </RegistrationLayout>
  );
}

const styles = StyleSheet.create({
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
  },
  counterReady: { backgroundColor: colors.successSoft },
  photos: { gap: spacing.sm, paddingVertical: spacing.xxs },
  photoWrap: {
    width: 132,
    height: 132,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.transparent,
    backgroundColor: colors.surfaceMuted,
  },
  photoSelected: { borderColor: colors.brand },
  photoPressable: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  selectedBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  remove: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 40,
    height: 40,
    backgroundColor: colors.surface,
  },
  add: {
    width: 132,
    height: 132,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  addIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  swapNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  noteText: { flex: 1 },
  pressed: { opacity: 0.7 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sourceSheet: {
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    backgroundColor: colors.surface,
    ...shadows.floating,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    alignSelf: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  sourceOption: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  sourceIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  optionCopy: { flex: 1, gap: spacing.xxs },
  previewBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.mediaCanvas,
  },
  previewImage: { width: '100%', height: '82%' },
  previewClose: {
    position: 'absolute',
    zIndex: 1,
    top: spacing.xxxl,
    right: spacing.md,
    backgroundColor: colors.surface,
  },
});

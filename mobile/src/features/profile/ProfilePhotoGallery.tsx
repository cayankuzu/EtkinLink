import { AppText, IconButton } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import type { ProfilePhoto } from '@shared/types/domain';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  ImageIcon,
  MoreVertical,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ViewStyle,
} from 'react-native';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  photos: ProfilePhoto[];
  accessibilityName: string;
  ownProfile?: boolean;
  onReport?: () => void | Promise<void>;
  navigationMode?: 'swipe' | 'buttons';
  allowFullscreen?: boolean;
  style?: ViewStyle;
};

export function ProfilePhotoGallery({
  photos,
  accessibilityName,
  ownProfile = false,
  onReport,
  navigationMode = 'swipe',
  allowFullscreen = true,
  style,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const fullscreenScroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const squareStyle = useMemo(() => ({ width, height: width }), [width]);

  useEffect(() => {
    setActiveIndex(index => Math.min(index, Math.max(photos.length - 1, 0)));
  }, [photos.length]);

  function onLayout(event: LayoutChangeEvent) {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== width) setWidth(nextWidth);
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width > 0)
      setActiveIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  function openPhoto(index: number) {
    if (!allowFullscreen) return;
    setFullscreenIndex(index);
    requestAnimationFrame(() =>
      fullscreenScroll.current?.scrollTo({
        x: index * screenWidth,
        animated: false,
      }),
    );
  }

  function movePhoto(direction: -1 | 1) {
    if (photos.length < 2) return;
    setActiveIndex(
      index => (index + direction + photos.length) % photos.length,
    );
  }

  async function downloadPhoto() {
    const photo = fullscreenIndex === null ? null : photos[fullscreenIndex];
    if (!photo || saving) return;
    setSaving(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'İzin gerekli',
          'Fotoğrafı kaydetmek için galeri erişimine izin vermelisin.',
        );
        return;
      }
      const sourceExtension = photo.storagePath
        .split('.')
        .at(-1)
        ?.toLowerCase();
      const extension =
        sourceExtension && /^(jpe?g|png|webp|heic|heif)$/.test(sourceExtension)
          ? sourceExtension
          : 'jpg';
      const destination = `${FileSystem.cacheDirectory}etkinlink-${photo.id}.${extension}`;
      const result = await FileSystem.downloadAsync(photo.url, destination);
      await MediaLibrary.createAssetAsync(result.uri);
      Alert.alert('Fotoğraf indirildi', 'Fotoğraf galerine kaydedildi.');
    } catch {
      Alert.alert(
        'Fotoğraf indirilemedi',
        'Bağlantını kontrol edip tekrar deneyebilirsin.',
      );
    } finally {
      setSaving(false);
    }
  }

  function openMenu() {
    if (ownProfile) {
      Alert.alert('Fotoğraf seçenekleri', undefined, [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: saving ? 'İndiriliyor…' : 'İndir',
          onPress: () => void downloadPhoto(),
        },
      ]);
      return;
    }
    if (onReport) {
      Alert.alert(
        'Fotoğrafı şikayet et',
        'Bu fotoğrafı topluluk kurallarına aykırı olduğu için bildirmek istiyor musun?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Şikayet et',
            style: 'destructive',
            onPress: () => void onReport(),
          },
        ],
      );
    }
  }

  return (
    <>
      <View style={[styles.wrapper, style]} onLayout={onLayout}>
        <View style={[styles.viewport, squareStyle]}>
          {photos.length > 0 && width > 0 && navigationMode === 'buttons' ? (
            <View style={squareStyle}>
              <Pressable
                accessibilityRole={allowFullscreen ? 'button' : undefined}
                accessibilityLabel={
                  allowFullscreen
                    ? `${accessibilityName}, fotoğraf ${
                        activeIndex + 1
                      }. Büyütmek için dokun`
                    : `${accessibilityName}, fotoğraf ${activeIndex + 1}`
                }
                disabled={!allowFullscreen}
                onPress={() => openPhoto(activeIndex)}
              >
                <Image
                  source={{ uri: photos[activeIndex]?.url }}
                  style={squareStyle}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              </Pressable>
              {photos.length > 1 ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Önceki fotoğraf"
                    hitSlop={8}
                    onPress={() => movePhoto(-1)}
                    style={[styles.photoArrow, styles.photoArrowLeft]}
                  >
                    <ChevronLeft size={24} color={colors.textInverse} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Sonraki fotoğraf"
                    hitSlop={8}
                    onPress={() => movePhoto(1)}
                    style={[styles.photoArrow, styles.photoArrowRight]}
                  >
                    <ChevronRight size={24} color={colors.textInverse} />
                  </Pressable>
                </>
              ) : null}
              {!allowFullscreen && onReport ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fotoğraf seçenekleri"
                  hitSlop={6}
                  onPress={openMenu}
                  style={styles.photoMenu}
                >
                  <MoreVertical size={21} color={colors.textInverse} />
                </Pressable>
              ) : null}
            </View>
          ) : photos.length > 0 && width > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={onScrollEnd}
              accessibilityLabel={`${accessibilityName} fotoğrafları`}
            >
              {photos.map((photo, index) => (
                <Pressable
                  key={photo.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${accessibilityName}, fotoğraf ${
                    index + 1
                  }. Büyütmek için dokun`}
                  onPress={() => openPhoto(index)}
                >
                  <Image
                    source={{ uri: photo.url }}
                    style={squareStyle}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.empty}>
              <ImageIcon size={40} color={colors.textTertiary} />
            </View>
          )}
        </View>
        {photos.length > 1 ? (
          <View style={styles.indicators}>
            {photos.map((photo, index) => (
              <View
                key={photo.id}
                style={[
                  styles.indicator,
                  index === activeIndex && styles.indicatorActive,
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>

      <Modal
        visible={fullscreenIndex !== null}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreenIndex(null)}
      >
        <StatusBar barStyle="light-content" backgroundColor="#050505" />
        <View style={styles.fullscreen}>
          <View style={[styles.fullscreenHeader, { paddingTop: insets.top }]}>
            <IconButton
              icon={X}
              label="Fotoğrafı kapat"
              onPress={() => setFullscreenIndex(null)}
              style={styles.fullscreenButton}
            />
            <AppText variant="label15" tone="inverse">
              {fullscreenIndex === null
                ? ''
                : `${fullscreenIndex + 1} / ${photos.length}`}
            </AppText>
            {ownProfile || onReport ? (
              <IconButton
                icon={MoreVertical}
                label="Fotoğraf seçenekleri"
                onPress={openMenu}
                style={styles.fullscreenButton}
              />
            ) : (
              <View style={styles.buttonSpacer} />
            )}
          </View>
          <ScrollView
            ref={fullscreenScroll}
            style={styles.fullscreenScroll}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onLayout={() => {
              if (fullscreenIndex !== null)
                fullscreenScroll.current?.scrollTo({
                  x: fullscreenIndex * screenWidth,
                  animated: false,
                });
            }}
            onMomentumScrollEnd={event => {
              if (screenWidth > 0)
                setFullscreenIndex(
                  Math.round(event.nativeEvent.contentOffset.x / screenWidth),
                );
            }}
          >
            {photos.map(photo => (
              <View
                key={photo.id}
                style={[styles.fullscreenPage, { width: screenWidth }]}
              >
                <Image
                  source={{ uri: photo.url }}
                  style={styles.fullscreenImage}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
              </View>
            ))}
          </ScrollView>
          <View style={styles.actionHint}>
            {ownProfile ? (
              <Download size={16} color={colors.textInverse} />
            ) : null}
            {!ownProfile && onReport ? (
              <Flag size={16} color={colors.textInverse} />
            ) : null}
            <AppText variant="caption12" tone="inverse">
              {ownProfile
                ? 'İndirmek için sağ üstteki menüyü kullan'
                : 'Şikayet için sağ üstteki menüyü kullan'}
            </AppText>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', gap: spacing.xs },
  viewport: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  indicators: { height: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  indicator: {
    width: 8,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  indicatorActive: { width: 20, backgroundColor: colors.brand },
  photoArrow: {
    position: 'absolute',
    top: '50%',
    width: 40,
    height: 40,
    marginTop: -20,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.56)',
  },
  photoArrowLeft: { left: spacing.sm },
  photoArrowRight: { right: spacing.sm },
  photoMenu: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 24, 40, 0.56)',
  },
  fullscreen: { flex: 1, backgroundColor: '#050505' },
  fullscreenHeader: {
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#050505',
  },
  fullscreenButton: {},
  buttonSpacer: { width: 48 },
  fullscreenScroll: { flex: 1 },
  fullscreenPage: { flex: 1, justifyContent: 'center' },
  fullscreenImage: { width: '100%', height: '100%' },
  actionHint: {
    minHeight: 52,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});

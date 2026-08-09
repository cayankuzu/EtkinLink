import { colors } from '@shared/theme';
import { CalendarDays } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

type Props = {
  imageUrl: string | null;
  style: StyleProp<ImageStyle>;
  placeholderStyle?: StyleProp<ViewStyle>;
  iconSize?: number;
};

export function compatibleEventImageUrl(imageUrl: string): string {
  if (!/\.avif(?:\?|$)/i.test(imageUrl)) return imageUrl;
  const params = new URLSearchParams({
    url: imageUrl,
    output: 'webp',
    w: '1200',
    q: '84',
  });
  return `https://wsrv.nl/?${params.toString()}`;
}

export function EventImage({
  imageUrl,
  style,
  placeholderStyle,
  iconSize = 38,
}: Props) {
  const [failed, setFailed] = useState(false);
  const uri = useMemo(
    () => (imageUrl ? compatibleEventImageUrl(imageUrl) : null),
    [imageUrl],
  );

  useEffect(() => setFailed(false), [uri]);

  if (!uri || failed) {
    return (
      <View
        style={[
          styles.placeholder,
          style as StyleProp<ViewStyle>,
          placeholderStyle,
        ]}
      >
        <CalendarDays size={iconSize} color={colors.textTertiary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
});

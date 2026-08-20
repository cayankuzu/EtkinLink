import { AppImage } from '@shared/components';
import { colors } from '@shared/theme';
import { CalendarDays } from 'lucide-react-native';
import {
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
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === 'https:' ? imageUrl : '';
  } catch {
    return '';
  }
}

export function EventImage({
  imageUrl,
  style,
  placeholderStyle,
  iconSize = 38,
}: Props) {
  const uri = imageUrl ? compatibleEventImageUrl(imageUrl) : null;
  const fallback = (
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

  return <AppImage uri={uri} style={style} fallback={fallback} />;
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
});

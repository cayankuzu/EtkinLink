import { colors, radius } from '@shared/theme';
import { useEffect, useRef } from 'react';
import type { ViewStyle } from 'react-native';
import { Animated, Easing, StyleSheet } from 'react-native';

type SkeletonProps = { style?: ViewStyle; accessibilityLabel?: string };

export function Skeleton({
  style,
  accessibilityLabel = 'İçerik yükleniyor',
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityLabel={accessibilityLabel}
      style={[styles.base, { opacity }, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
});

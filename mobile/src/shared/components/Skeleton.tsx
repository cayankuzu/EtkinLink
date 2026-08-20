import { colors, radius } from '@shared/theme';
import { useEffect, useRef, useState } from 'react';
import type { ViewStyle } from 'react-native';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';

type SkeletonProps = { style?: ViewStyle; accessibilityLabel?: string };

export function Skeleton({
  style,
  accessibilityLabel = 'İçerik yükleniyor',
}: SkeletonProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.65);
      return undefined;
    }
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
  }, [opacity, reduceMotion]);
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

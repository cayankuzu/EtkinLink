import { useCallback, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export type SwipeAction = 'like' | 'pass';

const swipeThreshold = 110;

export function useMatchCardGesture({
  width,
  reduceMotion,
  disabled,
  onSwipe,
}: {
  width: number;
  reduceMotion: boolean;
  disabled: boolean;
  onSwipe: (kind: SwipeAction) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const resetGesture = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [translateX, translateY]);

  const animateSwipe = useCallback(
    (kind: SwipeAction) => {
      if (disabled) return;
      if (reduceMotion) {
        onSwipe(kind);
        return;
      }
      translateX.value = withTiming(
        kind === 'like' ? width * 1.25 : -width * 1.25,
        { duration: 220 },
        finished => {
          if (finished) scheduleOnRN(onSwipe, kind);
        },
      );
    },
    [disabled, onSwipe, reduceMotion, translateX, width],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX([-24, 24])
        .failOffsetY([-22, 22])
        .onUpdate(event => {
          translateX.value = event.translationX;
          translateY.value = event.translationY * 0.18;
        })
        .onEnd(event => {
          if (Math.abs(event.translationX) >= swipeThreshold) {
            const kind: SwipeAction = event.translationX > 0 ? 'like' : 'pass';
            if (reduceMotion) {
              scheduleOnRN(onSwipe, kind);
              return;
            }
            translateX.value = withTiming(
              kind === 'like' ? width * 1.25 : -width * 1.25,
              { duration: 200 },
              finished => {
                if (finished) scheduleOnRN(onSwipe, kind);
              },
            );
            return;
          }
          translateX.value = withSpring(0, {
            damping: 18,
            stiffness: 190,
          });
          translateY.value = withSpring(0, {
            damping: 18,
            stiffness: 190,
          });
        }),
    [disabled, onSwipe, reduceMotion, translateX, translateY, width],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      {
        rotate: `${interpolate(
          translateX.value,
          [-width, 0, width],
          reduceMotion ? [0, 0, 0] : [-9, 0, 9],
        )}deg`,
      },
    ],
  }));
  const likeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [20, swipeThreshold],
      [0, 1],
      'clamp',
    ),
  }));
  const passStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-swipeThreshold, -20],
      [1, 0],
      'clamp',
    ),
  }));

  return { animateSwipe, cardStyle, likeStyle, pan, passStyle, resetGesture };
}

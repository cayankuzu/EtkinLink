import { AppText } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import { useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

type Props = {
  minimum?: number;
  maximum?: number;
  valueMin: number;
  valueMax: number;
  disabled?: boolean;
  onChange: (valueMin: number, valueMax: number) => void;
};

const thumbSize = 44;
const accessibilityActions = [
  { name: 'increment', label: 'Artır' },
  { name: 'decrement', label: 'Azalt' },
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function AgeRangeSlider({
  minimum = 18,
  maximum = 99,
  valueMin,
  valueMax,
  disabled = false,
  onChange,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const current = useRef({
    minimum,
    maximum,
    valueMin,
    valueMax,
    disabled,
    trackWidth,
    onChange,
  });
  current.current = {
    minimum,
    maximum,
    valueMin,
    valueMax,
    disabled,
    trackWidth,
    onChange,
  };
  const minDragStart = useRef(valueMin);
  const maxDragStart = useRef(valueMax);

  const minResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !current.current.disabled,
      onMoveShouldSetPanResponder: (_, gesture) =>
        !current.current.disabled && Math.abs(gesture.dx) > 2,
      onPanResponderGrant: () => {
        minDragStart.current = current.current.valueMin;
      },
      onPanResponderMove: (_, gesture) => {
        const state = current.current;
        if (state.trackWidth <= 0) return;
        const ageDelta = Math.round(
          (gesture.dx / state.trackWidth) * (state.maximum - state.minimum),
        );
        const next = clamp(
          minDragStart.current + ageDelta,
          state.minimum,
          state.valueMax,
        );
        state.onChange(next, state.valueMax);
      },
    }),
  ).current;
  const maxResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !current.current.disabled,
      onMoveShouldSetPanResponder: (_, gesture) =>
        !current.current.disabled && Math.abs(gesture.dx) > 2,
      onPanResponderGrant: () => {
        maxDragStart.current = current.current.valueMax;
      },
      onPanResponderMove: (_, gesture) => {
        const state = current.current;
        if (state.trackWidth <= 0) return;
        const ageDelta = Math.round(
          (gesture.dx / state.trackWidth) * (state.maximum - state.minimum),
        );
        const next = clamp(
          maxDragStart.current + ageDelta,
          state.valueMin,
          state.maximum,
        );
        state.onChange(state.valueMin, next);
      },
    }),
  ).current;

  const range = maximum - minimum;
  const minPosition =
    trackWidth > 0 ? ((valueMin - minimum) / range) * trackWidth : 0;
  const maxPosition =
    trackWidth > 0 ? ((valueMax - minimum) / range) * trackWidth : 0;

  function handleTrackLayout(event: LayoutChangeEvent) {
    setTrackWidth(event.nativeEvent.layout.width);
  }

  function handleTrackPress(event: GestureResponderEvent) {
    if (disabled || trackWidth <= 0) return;
    const ratio = clamp(event.nativeEvent.locationX / trackWidth, 0, 1);
    const selectedAge = Math.round(minimum + ratio * range);
    if (Math.abs(selectedAge - valueMin) <= Math.abs(selectedAge - valueMax)) {
      onChange(clamp(selectedAge, minimum, valueMax), valueMax);
    } else {
      onChange(valueMin, clamp(selectedAge, valueMin, maximum));
    }
  }

  return (
    <View style={[styles.wrapper, disabled ? styles.disabled : null]}>
      <View style={styles.valueRow}>
        <View style={styles.valuePill}>
          <AppText variant="label14" tone="brand">
            {valueMin} yaş
          </AppText>
        </View>
        <AppText variant="caption12" tone="secondary">
          Seçili aralık
        </AppText>
        <View style={styles.valuePill}>
          <AppText variant="label14" tone="brand">
            {valueMax} yaş
          </AppText>
        </View>
      </View>
      {/* The track itself is not a control: the two adjustable thumbs inside
          are. Leaving it accessible would collapse both of them into one
          VoiceOver node. */}
      <Pressable
        accessible={false}
        accessibilityRole="none"
        disabled={disabled}
        onLayout={handleTrackLayout}
        onPress={handleTrackPress}
        style={styles.slider}
      >
        <View style={styles.track} />
        <View
          style={[
            styles.activeTrack,
            {
              left: minPosition,
              width: Math.max(0, maxPosition - minPosition),
            },
          ]}
        />
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="En düşük yaş"
          accessibilityValue={{
            min: minimum,
            max: valueMax,
            now: valueMin,
            text: `${valueMin} yaş`,
          }}
          accessibilityActions={[...accessibilityActions]}
          onAccessibilityAction={event => {
            const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            onChange(clamp(valueMin + delta, minimum, valueMax), valueMax);
          }}
          {...minResponder.panHandlers}
          style={[styles.thumbTouch, { left: minPosition - thumbSize / 2 }]}
        >
          <View style={styles.thumb} />
        </View>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="En yüksek yaş"
          accessibilityValue={{
            min: valueMin,
            max: maximum,
            now: valueMax,
            text: `${valueMax} yaş`,
          }}
          accessibilityActions={[...accessibilityActions]}
          onAccessibilityAction={event => {
            const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
            onChange(valueMin, clamp(valueMax + delta, valueMin, maximum));
          }}
          {...maxResponder.panHandlers}
          style={[styles.thumbTouch, { left: maxPosition - thumbSize / 2 }]}
        >
          <View style={styles.thumb} />
        </View>
      </Pressable>
      <View style={styles.limitRow}>
        <AppText variant="tiny11" tone="tertiary">
          {minimum}
        </AppText>
        <AppText variant="tiny11" tone="tertiary">
          {maximum}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  disabled: { opacity: 0.58 },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  valuePill: {
    minWidth: 68,
    alignItems: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  slider: {
    height: 48,
    justifyContent: 'center',
    marginHorizontal: thumbSize / 2,
  },
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  activeTrack: {
    position: 'absolute',
    top: 21,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  thumbTouch: {
    position: 'absolute',
    top: 2,
    width: thumbSize,
    height: thumbSize,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 26,
    height: 26,
    borderWidth: 3,
    borderColor: colors.surface,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

// F-19 G15 (#187): drag a sheet down to close it. UI thread only; JS is called once, on close.
import { useCallback } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { commits, rubber } from './gestureMath';
import { settle } from './motion';

export function useDragClose(onClose: () => void, enabled = true) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  const h = useSharedValue(600);
  const pan = usePanGesture({
    enabled,
    activeOffsetY: 8,
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      const t = e.translationY;
      y.set(t > 0 ? t : rubber(t, 40));
    },
    onDeactivate: (e) => {
      'worklet';
      if (y.get() > 0 && commits(y.get(), e.velocityY, h.get())) {
        y.set(withTiming(h.get(), { duration: 180 }, (done) => {
          if (done) scheduleOnRN(onClose);
        }));
      } else y.set(settle(0, reduce, e.velocityY));
    },
  });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, y.get()) / Math.max(1, h.get())) }));
  const onLayout = useCallback((e: LayoutChangeEvent) => h.set(e.nativeEvent.layout.height), [h]);
  const reset = useCallback(() => y.set(0), [y]);
  return { pan, sheetStyle, scrimStyle, onLayout, reset };
}

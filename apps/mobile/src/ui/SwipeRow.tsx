// F-19 G5 (#187): list row with swipe actions. Swipe reveals the buttons; a long swipe runs the first one.
// UI thread only. Vertical scroll always wins (R-19.4); every action is also a screen reader action (R-19.2).
import React, { useCallback, useState } from 'react';
import { type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { color, font, type } from '../theme/tokens';
import { rubber } from './gestureMath';
import { feel } from './haptics';
import { settle } from './motion';

export type SwipeAction = { key: string; label: string; icon: React.ReactNode; fill: string; on: () => void };

const BTN = 76;
/** Fraction of the row width past which a long swipe runs the first action. */
export const FULL = 0.6;

/** Where a released row settles: 'full' runs the first action, 'open' shows the buttons. */
export function swipeEnd(t: number, v: number, n: number, width: number): 'full' | 'open' | 'closed' {
  'worklet';
  const a = Math.abs(t);
  if (n === 0) return 'closed';
  if (a > width * FULL) return 'full';
  if (a > (n * BTN) / 2 || (Math.abs(v) > 600 && a > 24 && Math.sign(v) === Math.sign(t))) return 'open';
  return 'closed';
}

type Props = {
  /** Revealed by a swipe to the right (shown on the left). */
  left?: SwipeAction[];
  /** Revealed by a swipe to the left (shown on the right). */
  right?: SwipeAction[];
  testID?: string;
  children: React.ReactNode;
};

export function SwipeRow({ left = [], right = [], testID, children }: Props) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const w = useSharedValue(360);
  const armed = useSharedValue(0);
  const [open, setOpen] = useState(false);
  const nl = left.length;
  const nr = right.length;

  const tick = useCallback(() => feel('tick'), []);
  const run = useCallback(
    (side: 1 | -1) => {
      const a = side > 0 ? left[0] : right[0];
      if (!a) return;
      feel('tap');
      a.on();
    },
    [left, right],
  );

  const pan = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-10, 10],
    onBegin: () => {
      'worklet';
      start.set(x.get());
    },
    onUpdate: (e) => {
      'worklet';
      let t = start.get() + e.translationX;
      if ((t > 0 && nl === 0) || (t < 0 && nr === 0)) t = rubber(t, 30);
      x.set(t);
      const full = Math.abs(t) > w.get() * FULL ? Math.sign(t) : 0;
      if (full !== armed.get()) {
        armed.set(full);
        if (full) scheduleOnRN(tick);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      const t = x.get();
      const n = t > 0 ? nl : nr;
      const end = swipeEnd(t, e.velocityX, n, w.get());
      armed.set(0);
      if (end === 'full') {
        const side = t > 0 ? 1 : -1;
        x.set(withTiming(side * w.get(), { duration: 160 }, () => {
          x.set(0);
          scheduleOnRN(run, side);
        }));
        scheduleOnRN(setOpen, false);
      } else if (end === 'open') {
        x.set(settle(Math.sign(t) * n * BTN, reduce, e.velocityX));
        scheduleOnRN(setOpen, true);
      } else {
        x.set(settle(0, reduce, e.velocityX));
        scheduleOnRN(setOpen, false);
      }
    },
  });

  const close = () => {
    x.set(settle(0, reduce));
    setOpen(false);
  };
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: x.get() > 0 ? 1 : 0 }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: x.get() < 0 ? 1 : 0 }));
  const all = [...left, ...right];

  return (
    <View
      testID={testID}
      onLayout={(e: LayoutChangeEvent) => w.set(e.nativeEvent.layout.width)}
      accessibilityActions={all.map((a) => ({ name: a.key, label: a.label }))}
      onAccessibilityAction={(e) => all.find((a) => a.key === e.nativeEvent.actionName)?.on()}
    >
      {nl ? (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' }, leftStyle]}>
          {left.map((a) => (
            <Btn key={a.key} a={a} after={close} />
          ))}
        </Animated.View>
      ) : null}
      {nr ? (
        <Animated.View style={[{ position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' }, rightStyle]}>
          {/* The first action sits on the outer edge: it is the one a long swipe runs. */}
          {[...right].reverse().map((a) => (
            <Btn key={a.key} a={a} after={close} />
          ))}
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: color.bgBase }, rowStyle]}>
          {children}
          {open ? <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} onPress={close} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /> : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function Btn({ a, after }: { a: SwipeAction; after: () => void }) {
  return (
    <Pressable
      testID={`swipe-${a.key}`}
      accessibilityRole="button"
      accessibilityLabel={a.label}
      onPress={() => {
        after();
        feel('tap');
        a.on();
      }}
      style={{ width: BTN, backgroundColor: a.fill, alignItems: 'center', justifyContent: 'center', gap: 4 }}
    >
      {a.icon}
      <Text numberOfLines={1} style={{ ...type.caption, fontFamily: font.heavy, color: color.onAccent }}>
        {a.label}
      </Text>
    </Pressable>
  );
}

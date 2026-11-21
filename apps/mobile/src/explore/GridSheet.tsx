import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { clamp, rubber } from '../ui/gestureMath';
import { feel } from '../ui/haptics';
import { settle } from '../ui/motion';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';

// #250 option B: two stops. `peek` = strip (handle, title row, Moments row); `full` = up to the header.
export type Snap = 'peek' | 'full';
export const SNAPS: Snap[] = ['peek', 'full'];

/** Strip height above the tab bar: handle 28 + title row 40 + Moments row 94 + 2. */
export const STRIP = 164;

/** Visible sheet height per snap (R-04.14). `h` = Explore body height, `bottom` = space taken by the floating tab bar. */
export function snapHeight(snap: Snap, h: number, bottom: number): number {
  if (snap === 'full') return h;
  return Math.min(h, bottom + STRIP);
}

/** Saved snap from before #250 (`half`) or junk → the strip. */
export function restoreSnap(v: string | null): Snap {
  return v === 'full' ? 'full' : 'peek';
}

/** Snap after a drag: a fling goes one step in its direction, otherwise the nearest snap. */
export function snapAfterDrag(visible: number, vy: number, h: number, bottom: number, from: Snap): Snap {
  const i = SNAPS.indexOf(from);
  if (vy < -0.5) return SNAPS[Math.min(SNAPS.length - 1, i + 1)];
  if (vy > 0.5) return SNAPS[Math.max(0, i - 1)];
  let best: Snap = from;
  let dist = Infinity;
  for (const s of SNAPS) {
    const d = Math.abs(snapHeight(s, h, bottom) - visible);
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  return best;
}

const NEXT: Record<Snap, Snap> = { peek: 'full', full: 'peek' };

type Props = {
  h: number;
  bottom: number;
  snap: Snap;
  onSnap: (s: Snap) => void;
  title: string;
  right?: string;
  /** Floats 12 pt above the sheet edge and moves with it (Locate me, zoom chip). */
  above?: React.ReactNode;
  children: React.ReactNode;
};

// S-10 grid sheet over the map (F-04 R-04.14, design-system.md › Explore grid sheet).
// F-19 G7 (#187): the drag runs on the UI thread (gesture-handler + reanimated): follows the finger,
// rubber band past the top, a fling goes one stop, one haptic tick per stop reached.
export function GridSheet({ h, bottom, snap, onSnap, title, right, above, children }: Props) {
  const reduce = useReducedMotion();
  const y = useSharedValue(h - snapHeight(snap, h, bottom));
  const start = useSharedValue(0);
  const live = useRef({ snap, onSnap });
  useEffect(() => {
    live.current = { snap, onSnap };
  }, [snap, onSnap]);

  useEffect(() => {
    y.set(settle(h - snapHeight(snap, h, bottom), reduce));
  }, [snap, h, bottom, y, reduce]);

  const release = useCallback(
    (visible: number, vy: number) => {
      const L = live.current;
      const next = snapAfterDrag(visible, vy, h, bottom, L.snap);
      if (next === L.snap) y.set(settle(h - snapHeight(next, h, bottom), reduce));
      else feel('tick');
      L.onSnap(next);
    },
    [h, bottom, y, reduce],
  );

  const top = h - snapHeight('full', h, bottom);
  const low = h - snapHeight('peek', h, bottom);
  const pan = usePanGesture({
    activeOffsetY: [-6, 6],
    failOffsetX: [-24, 24],
    onBegin: () => {
      'worklet';
      cancelAnimation(y);
      start.set(y.get());
    },
    onUpdate: (e) => {
      'worklet';
      const t = start.get() + e.translationY;
      y.set(t < top ? top + rubber(t - top) : Math.min(low, t));
    },
    onDeactivate: (e) => {
      'worklet';
      const visible = h - clamp(y.get(), 0, h);
      scheduleOnRN(release, visible, e.velocityY / 1000);
    },
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  return (
    <Animated.View
      testID="grid-sheet"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: h,
          backgroundColor: color.bgBase,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          shadowColor: 'black',
          shadowOpacity: 0.45,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -8 },
          elevation: 12,
        },
        style,
      ]}
    >
      {above ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 12, minHeight: 44, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center' }}>
          {above}
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <View>
        <Pressable
          testID="sheet-handle"
          accessibilityRole="adjustable"
          accessibilityLabel={tx.explore.sheet}
          accessibilityValue={{ text: snap }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const i = SNAPS.indexOf(snap);
            onSnap(SNAPS[e.nativeEvent.actionName === 'increment' ? Math.min(SNAPS.length - 1, i + 1) : Math.max(0, i - 1)]);
          }}
          onPress={() => onSnap(NEXT[snap])}
          style={{ height: 28, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 40, height: 5, borderRadius: radius.pill, backgroundColor: color.line }} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s }}>
          <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary, flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          {right ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{right}</Text> : null}
        </View>
        </View>
      </GestureDetector>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}

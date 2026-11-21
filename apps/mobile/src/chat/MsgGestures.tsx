// F-19 G1–G4 (#187): gestures on one chat message, all on the UI thread.
// G1 swipe right = reply · G2 double-tap (theirs) = ❤️ · G3 hold = reaction bar, slide to an emoji and let go
// · G4 swipe left = every bubble slides and shows its time. Every action also sits in the hold menu and in
// the screen reader actions (R-19.1, R-19.2).
import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { gx } from '../i18n/gestures';
import { color, type } from '../theme/tokens';
import { Icon } from '../ui';
import { clamp, rubber, TAP_SLOP } from '../ui/gestureMath';
import { feel } from '../ui/haptics';
import { settle } from '../ui/motion';

/** G1: travel that commits a reply. */
export const REPLY_AT = 56;
/** G4: how far the bubbles slide to show times. */
export const TIMES_W = 60;

export type Hold = { top: number; height: number };

/** Shared state of one chat screen: the times slide (G4) and the finger while holding (G3). */
export function useChatGestures() {
  const timesX = useSharedValue(0);
  const fx = useSharedValue(-1);
  const fy = useSharedValue(-1);
  return { timesX, fx, fy };
}
export type ChatGestures = ReturnType<typeof useChatGestures>;

type Props = {
  mine: boolean;
  at: number;
  g: ChatGestures;
  onReply: () => void;
  /** Theirs only (G2). */
  onHeart?: () => void;
  onHold: (h: Hold) => void;
  /** Finger lifted after a hold; x / y in window coordinates. */
  onHoldEnd: (x: number, y: number) => void;
  a11yMore: () => void;
  children: React.ReactNode;
};

export function MsgRow({ mine, at, g, onReply, onHeart, onHold, onHoldEnd, a11yMore, children }: Props) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  const h = useSharedValue(0);
  const armed = useSharedValue(false);
  const { timesX, fx, fy } = g;

  const tick = useCallback(() => feel('tick'), []);
  const swipe = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      const t = e.translationX;
      if (t > 0) {
        x.set(t < REPLY_AT ? t : REPLY_AT + rubber(t - REPLY_AT, 40));
        const on = t >= REPLY_AT;
        if (on !== armed.get()) {
          armed.set(on);
          if (on) scheduleOnRN(tick);
        }
      } else timesX.set(clamp(t, -TIMES_W, 0) + (t < -TIMES_W ? rubber(t + TIMES_W, 20) : 0));
    },
    onDeactivate: () => {
      'worklet';
      if (armed.get()) scheduleOnRN(onReply);
      armed.set(false);
      x.set(settle(0, reduce));
      timesX.set(settle(0, reduce));
    },
  });
  const hold = usePanGesture({
    activateAfterLongPress: 350,
    onActivate: (e) => {
      'worklet';
      fx.set(e.absoluteX);
      fy.set(e.absoluteY);
      scheduleOnRN(onHold, { top: e.absoluteY - e.y, height: h.get() });
    },
    onUpdate: (e) => {
      'worklet';
      fx.set(e.absoluteX);
      fy.set(e.absoluteY);
    },
    onDeactivate: (e) => {
      'worklet';
      fx.set(-1);
      fy.set(-1);
      scheduleOnRN(onHoldEnd, e.absoluteX, e.absoluteY);
    },
  });
  const twice = useTapGesture({
    enabled: !!onHeart,
    numberOfTaps: 2,
    maxDistance: TAP_SLOP,
    maxDelay: 250,
    onActivate: () => {
      'worklet';
      if (onHeart) scheduleOnRN(onHeart);
    },
  });
  const gesture = useCompetingGestures(hold, swipe, twice);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() + timesX.get() }] }));
  const iconStyle = useAnimatedStyle(() => {
    const p = Math.min(1, x.get() / REPLY_AT);
    return { opacity: p, transform: [{ scale: 0.5 + p * 0.5 }] };
  });
  const timeStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, -timesX.get() / TIMES_W) }));
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <GestureDetector gesture={gesture}>
      <View
        onLayout={(e) => h.set(e.nativeEvent.layout.height)}
        accessibilityActions={[
          { name: 'reply', label: gx.reply },
          ...(onHeart ? [{ name: 'heart', label: gx.heart }] : []),
          { name: 'more', label: gx.more },
        ]}
        onAccessibilityAction={(e) => {
          const n = e.nativeEvent.actionName;
          if (n === 'reply') onReply();
          else if (n === 'heart') onHeart?.();
          else a11yMore();
        }}
      >
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }, iconStyle]}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color.friends, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Reply c={color.onAccent} />
          </View>
        </Animated.View>
        <Animated.View style={rowStyle}>
          {children}
          <Animated.Text
            importantForAccessibility="no"
            accessibilityElementsHidden
            style={[{ position: 'absolute', right: -TIMES_W, width: TIMES_W - 8, bottom: mine ? 18 : 6, textAlign: 'right', ...type.caption, color: color.fgMuted }, timeStyle]}
          >
            {time}
          </Animated.Text>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** G3: the reaction bar over a held message. `hover` follows the finger while it is still down. */
export function ReactionBar({ emojis, x, y, oy, w, g, onPick }: { emojis: string[]; x: number; y: number; /** root's top in the window */ oy: number; w: number; g: ChatGestures; onPick: (e: string) => void }) {
  const slot = w / emojis.length;
  return (
    <View testID="reaction-bar" style={{ position: 'absolute', left: x, top: y, width: w, height: 52, borderRadius: 26, backgroundColor: color.bgInverse, flexDirection: 'row', alignItems: 'center', shadowColor: 'black', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 16 }}>
      {emojis.map((e, i) => (
        <Emoji key={e} e={e} i={i} slot={slot} x={x} y={y + oy} g={g} onPick={onPick} />
      ))}
    </View>
  );
}

function Emoji({ e, i, slot, x, y, g, onPick }: { e: string; i: number; slot: number; x: number; y: number; g: ChatGestures; onPick: (e: string) => void }) {
  const style = useAnimatedStyle(() => {
    const on = hit(g.fx, g.fy, x, y, slot) === i;
    return { transform: [{ scale: on ? 1.45 : 1 }, { translateY: on ? -10 : 0 }] };
  });
  return (
    <Animated.View style={[{ width: slot, alignItems: 'center' }, style]}>
      <Text accessibilityRole="button" accessibilityLabel={e} onPress={() => onPick(e)} style={{ fontSize: 26, lineHeight: 34 }}>
        {e}
      </Text>
    </Animated.View>
  );
}

/** Which emoji slot is under the finger (−1 = none). Bar is 52 high; a band of 30 pt above / below still counts. */
export function hitSlot(fx: number, fy: number, x: number, y: number, slot: number, n: number): number {
  'worklet';
  if (fx < 0 || fy < y - 30 || fy > y + 52 + 30) return -1;
  const i = Math.floor((fx - x) / slot);
  return i >= 0 && i < n ? i : -1;
}

function hit(fx: SharedValue<number>, fy: SharedValue<number>, x: number, y: number, slot: number) {
  'worklet';
  return hitSlot(fx.get(), fy.get(), x, y, slot, Number.MAX_SAFE_INTEGER);
}

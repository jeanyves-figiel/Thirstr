import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { color, motion, radius, space, type } from '../theme/tokens';
import { useNavSpace } from './index';

// App-wide toast (#111): one line + optional action (Undo). Shown above the tab bar for 5 s.
type T = {
  id: number;
  text: string;
  action?: { label: string; on: () => void };
};
let listener: ((t: T | null) => void) | null = null;
let seq = 0;

let lifter: ((n: number) => void) | null = null;
/** Extra height above the nav bar a screen's own bottom bar takes (Profile action bar). */
export function setToastLift(n: number) {
  lifter?.(n);
}

export function toast(text: string, action?: T['action']) {
  listener?.({ id: ++seq, text, action });
}

export function ToastHost() {
  const nav = useNavSpace();
  const [lift, setLift] = useState(0);
  useEffect(() => {
    lifter = setLift;
    return () => {
      lifter = null;
    };
  }, []);
  const [t, setT] = useState<T | null>(null);
  const [a] = useState(() => new Animated.Value(0));
  useEffect(() => {
    listener = setT;
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    a.setValue(0);
    Animated.timing(a, {
      toValue: 1,
      duration: motion.base,
      useNativeDriver: true,
    }).start();
    const h = setTimeout(
      () =>
        Animated.timing(a, {
          toValue: 0,
          duration: motion.base,
          useNativeDriver: true,
        }).start(() => setT((c) => (c?.id === t.id ? null : c))),
      5000,
    );
    return () => clearTimeout(h);
  }, [t, a]);
  if (!t) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: space.l,
        right: space.l,
        // #137: above the nav bar (+ a screen's own bottom bar via setToastLift); on the keyboard while typing.
        bottom: nav.bottom + 12 + lift,
        opacity: a,
        transform: [
          {
            translateY: a.interpolate({
              inputRange: [0, 1],
              outputRange: [16, 0],
            }),
          },
        ],
      }}
    >
      <View
        testID="toast"
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.m,
          backgroundColor: color.bgInverse,
          borderRadius: radius.md - 4,
          paddingHorizontal: space.l,
          minHeight: 48,
        }}
      >
        <Text
          style={{
            ...type.headline,
            fontSize: 14,
            color: color.onAccent,
            flex: 1,
          }}
          numberOfLines={3}
        >
          {t.text}
        </Text>
        {t.action ? (
          <Pressable
            testID="toast-action"
            accessibilityRole="button"
            hitSlop={12}
            style={{
              backgroundColor: color.onAccent,
              borderRadius: radius.pill,
              paddingHorizontal: space.m,
              height: 32,
              justifyContent: 'center',
            }}
            onPress={() => {
              t.action?.on();
              setT(null);
            }}
          >
            <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{t.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

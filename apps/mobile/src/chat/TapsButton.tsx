import { useIsFocused } from '@react-navigation/native';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { Tap } from '../api/types';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon, Photo } from '../ui';
import { useTopics } from './hooks';
import { isTyping } from './engine';

const FACE = 44;
const OVERLAP = 16;

/**
 * S-40 Spotlight (#211, R-07.40): full-width coral Taps button. Up to two faces of the latest
 * unseen tappers, then the flame with a pulsing ring (UI thread, off with Reduce Motion).
 */
export function TapsButton({ taps, onPress }: { taps: Tap[] | null; onPress: () => void }) {
  // Energy: the pulse only runs while Chats is on screen.
  const focused = useIsFocused();
  const fresh = (taps ?? []).filter((t) => !t.seen);
  const faces = fresh.slice(0, 2);
  const names = fresh.map((t) => t.profile.display_name.split(',')[0]);
  const mutual = fresh.filter((t) => t.mutual).length;
  const title = tx.chat.tapsTitle(fresh.length);
  const sub = fresh.length ? tx.chat.tapsWho(names, mutual) : tx.chat.tapsNew(0);
  return (
    <Pressable
      testID="inbox-taps"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          marginHorizontal: space.l,
          marginBottom: space.m + 2,
          minHeight: 72,
          borderRadius: radius.tray,
          backgroundColor: color.hookup,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.m + 2,
          paddingLeft: space.m,
          paddingRight: space.m + 2,
          paddingVertical: space.m,
          shadowColor: color.hookup,
          shadowOpacity: 0.35,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
        },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {faces.map((t, i) => (
          <Photo
            key={t.profile.id}
            uri={t.profile.photo}
            id={t.profile.id}
            label=""
            style={{ width: FACE, height: FACE, borderRadius: FACE / 2, borderWidth: 3, borderColor: color.hookup, marginLeft: i ? -OVERLAP : 0 }}
          />
        ))}
        <Flame first={!faces.length} live={fresh.length > 0 && focused} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.heavy, fontSize: 18, lineHeight: 22, letterSpacing: -0.3, color: color.onAccent }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ ...type.meta, fontFamily: font.bold, color: color.onAccent, opacity: 0.72 }}>
          {sub}
        </Text>
      </View>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.onAccent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon.Chevron size={16} c={color.hookup} w={3} d="M9 5l7 7-7 7" />
      </View>
    </Pressable>
  );
}

function Flame({ first, live }: { first: boolean; live: boolean }) {
  const reduce = useReducedMotion();
  const ring = useSharedValue(0);
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduce || !live) return;
    ring.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
    bob.set(withRepeat(withSequence(withTiming(-3, { duration: 1200 }), withTiming(0, { duration: 1200 })), -1, false));
    return () => {
      cancelAnimation(ring);
      cancelAnimation(bob);
    };
  }, [reduce, live, ring, bob]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - ring.get()), transform: [{ scale: 1 + 0.9 * ring.get() }] }));
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.get() }] }));
  return (
    <View style={{ width: FACE, height: FACE, marginLeft: first ? 0 : -OVERLAP }}>
      {live && !reduce ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: FACE / 2, borderWidth: 2, borderColor: color.onAccent }, ringStyle]} />
      ) : null}
      <View style={{ width: FACE, height: FACE, borderRadius: FACE / 2, backgroundColor: color.onAccent, borderWidth: 3, borderColor: color.hookup, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={bobStyle}>
          <Icon.Flame size={20} c={color.hookup} fill={color.hookup} />
        </Animated.View>
      </View>
    </View>
  );
}

/** R-07.41: "typing…" with three breathing dots in the row preview; expires 6 s after the last event. */
export function TypingLine({ cid, tint, children }: { cid: string | null; tint: string; children: React.ReactNode }) {
  const tick = useTopics('typing:' + (cid ?? '-'));
  const [, force] = React.useState(0);
  const on = !!cid && isTyping(cid);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => force((n) => n + 1), 6000);
    return () => clearTimeout(t);
  }, [on, tick]);
  if (!on) return <>{children}</>;
  return (
    <View testID={`typing-${cid}`} style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={tx.chat.typing}>
      <Text style={{ ...type.body, fontSize: 14, fontFamily: font.bold, color: tint }}>{tx.chat.typing.replace(/…$/, '')}</Text>
      <Dots tint={tint} />
    </View>
  );
}

function Dots({ tint }: { tint: string }) {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(3, { duration: 1200, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(t);
  }, [reduce, t]);
  const d0 = useAnimatedStyle(() => ({ opacity: reduce ? 1 : Math.abs(t.get() - 0.5) < 0.5 ? 1 : 0.25 }));
  const d1 = useAnimatedStyle(() => ({ opacity: reduce ? 1 : Math.abs(t.get() - 1.5) < 0.5 ? 1 : 0.25 }));
  const d2 = useAnimatedStyle(() => ({ opacity: reduce ? 1 : Math.abs(t.get() - 2.5) < 0.5 ? 1 : 0.25 }));
  const st = { ...type.body, fontSize: 14, fontFamily: font.heavy, color: tint };
  return (
    <>
      <Animated.Text style={[st, d0]}>.</Animated.Text>
      <Animated.Text style={[st, d1]}>.</Animated.Text>
      <Animated.Text style={[st, d2]}>.</Animated.Text>
    </>
  );
}

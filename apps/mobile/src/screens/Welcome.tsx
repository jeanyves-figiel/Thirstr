import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { api } from '../api/client';
import { o } from '../i18n/onboarding';
import { displayCount } from '../onboarding/flow';
import { BigButton, Enter } from '../onboarding/kit';
import { color, font, radius, space } from '../theme/tokens';
import { Wordmark } from '../ui';

type Welcome = { city: string | null; center: { lat: number; lng: number } | null; count: number | null; cells: { cell: string; count: number }[] };

// S-01 v2 (R-02.2, R-02.1): drifting blurred activity, live chip, count, 3 promises. No permission needed.
export function WelcomeScreen({ onStart, onLogin, onLink }: { onStart: () => void; onLogin: () => void; onLink?: () => void }) {
  const insets = useSafeAreaInsets();
  const [w, setW] = useState<Welcome | null>(null);
  useEffect(() => {
    api<Welcome>('GET', '/welcome').then(setW).catch(() => setW(null));
  }, []);
  const n = displayCount(w?.count ?? null);

  return (
    <View style={x.root}>
      <Blobs />
      <View style={[x.top, { paddingTop: insets.top + space.xxxl }]}>
        <Enter>
          <Wordmark size={52} />
        </Enter>
      </View>
      <View style={[x.bottom, { paddingBottom: Math.max(insets.bottom, space.l) + space.s }]}>
        <Enter delay={80} style={{ gap: 14 }}>
          <View style={x.live}>
            <Pulse />
            <Text style={x.liveText}>{o.welcome.live(w?.city ?? null)}</Text>
          </View>
          <Text style={x.headline} accessibilityRole="header">
            {n ? o.welcome.count(n) : o.welcome.joining}
          </Text>
        </Enter>
        <Enter delay={160} style={{ gap: space.m }}>
          {o.welcome.promises.map((p, i) => (
            <View key={p} style={x.promise}>
              <View style={x.icon}>{ICONS[i]}</View>
              <Text style={x.promiseText}>{p}</Text>
            </View>
          ))}
        </Enter>
        <Enter delay={240} style={{ gap: space.xs }}>
          <BigButton testID="start" title={o.welcome.start} onPress={onStart} />
          <BigButton kind="text" title={o.welcome.login} onPress={onLogin} />
          {onLink ? <BigButton testID="link-device" kind="text" title={o.welcome.link} onPress={onLink} /> : null}
        </Enter>
      </View>
    </View>
  );
}

const stroke = { stroke: color.trust, strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const ICONS = [
  <Svg key="p" width={18} height={18} viewBox="0 0 24 24">
    <Rect x={7} y={2} width={10} height={20} rx={2} {...stroke} />
    <Path d="M3 3l18 18" {...stroke} />
  </Svg>,
  <Svg key="l" width={18} height={18} viewBox="0 0 24 24">
    <Path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" {...stroke} />
    <Circle cx={12} cy={10} r={2.5} {...stroke} />
  </Svg>,
  <Svg key="e" width={18} height={18} viewBox="0 0 24 24">
    <Rect x={4} y={11} width={16} height={10} rx={2} {...stroke} />
    <Path d="M8 11V7a4 4 0 018 0v4" {...stroke} />
  </Svg>,
];

function useLoop(ms: number) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((still) => {
        if (still) return;
        loop = Animated.loop(Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        ]));
        loop.start();
      });
    return () => loop?.stop();
  }, [v, ms]);
  return v;
}

// Stepped scrim so the glow fades into ink without a hard edge (no gradient dependency).
const FADE = [0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72];

const BLOBS = [
  { c: color.hookup, x: 30, y: 300, s: 190, o: 0.8, ms: 9000, dx: 30, dy: -24 },
  { c: color.friends, x: 200, y: 200, s: 170, o: 0.75, ms: 11000, dx: -26, dy: 20 },
  { c: color.sport, x: 220, y: 430, s: 130, o: 0.5, ms: 13000, dx: 24, dy: -18 },
  { c: color.hookup, x: 110, y: 140, s: 110, o: 0.6, ms: 10000, dx: -20, dy: 22 },
];

/** Decorative: soft activity glow. Blur via large rounded shapes + low opacity (no native blur dependency). */
function Blobs() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
      {BLOBS.map((b, i) => (
        <Blob key={i} {...b} />
      ))}
      {FADE.map((op, i) => (
        <View key={i} style={[x.band, { top: `${40 + i * 3}%`, opacity: op }]} />
      ))}
      <View style={x.fade} />
    </View>
  );
}

function Blob({ c, x: left, y: top, s, o: op, ms, dx, dy }: (typeof BLOBS)[number]) {
  const v = useLoop(ms);
  const tx = v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const ty = v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] });
  const size = s * 2; // glow extends past the core
  const id = `g${left}${top}`;
  return (
    <Animated.View style={{ position: 'absolute', left: left - s / 2, top: top - s / 2, width: size, height: size, transform: [{ translateX: tx }, { translateY: ty }] }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={c} stopOpacity={op} />
            <Stop offset="0.45" stopColor={c} stopOpacity={op * 0.55} />
            <Stop offset="1" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={s} cy={s} r={s} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

function Pulse() {
  const v = useLoop(1600);
  return (
    <View style={{ width: 8, height: 8 }}>
      <Animated.View style={{ position: 'absolute', left: -5, top: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: color.trust, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v }] }} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.trust }} />
    </View>
  );
}

const x = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgBase, overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0, height: '3%', backgroundColor: color.bgBase },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '76%', backgroundColor: color.bgBase, opacity: 0.78 },
  top: { paddingHorizontal: space.xxl },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xxl, gap: 22 },
  live: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.m, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: 'rgba(38,34,72,0.85)' },
  liveText: { fontFamily: font.medium, fontSize: 13, color: color.fgSecondary },
  headline: { fontFamily: font.heavy, fontSize: 42, lineHeight: 44, letterSpacing: -1.3, color: color.fgPrimary },
  promise: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  promiseText: { flex: 1, fontFamily: font.regular, fontSize: 15, lineHeight: 20, color: color.fgSecondary },
});

import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { o } from '../i18n/onboarding';
import { color, font, motion, radius, space, touch } from '../theme/tokens';
import { useKeyboardShown } from '../ui';

// Onboarding v2 building blocks (F-02 R-02.1, issue 54). Pop tokens only.
export const STEPS = 7;

export function tick() {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
}

/** Fade + 14 pt rise on mount (motion.slow); Reduce Motion ⇒ fade only. */
export function Enter({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: object }) {
  const [a] = useState(() => new Animated.Value(0));
  const [still, setStill] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setStill)
      .catch(() => {});
    Animated.timing(a, { toValue: 1, duration: motion.slow, delay, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [a, delay]);
  const translateY = still ? 0 : a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={[{ opacity: a, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

export function Chevron({ c = color.fgPrimary }: { c?: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable testID="onb-back" accessibilityRole="button" accessibilityLabel={o.back} onPress={onPress} hitSlop={6} style={({ pressed }) => [k.back, pressed && k.pressed]}>
      <Chevron />
    </Pressable>
  );
}

export function StepBar({ step }: { step: number }) {
  return (
    <View style={k.barRow}>
      <View style={k.bar} accessibilityRole="progressbar" accessibilityLabel={o.step(step, STEPS)} accessibilityValue={{ min: 0, max: STEPS, now: step }}>
        {Array.from({ length: STEPS }, (_, i) => (
          <View key={i} style={[k.seg, { backgroundColor: i < step - 1 ? color.hookup : i === step - 1 ? color.fgPrimary : color.line }]} />
        ))}
      </View>
      <Text style={k.count}>
        {step}/{STEPS}
      </Text>
    </View>
  );
}

type Cta = { title: string; onPress: () => void; disabled?: boolean; busy?: boolean; fill?: string; testID?: string };

export function BigButton({ title, onPress, disabled, busy, fill = color.hookup, testID, kind = 'fill' }: Cta & { kind?: 'fill' | 'raised' | 'text' | 'white' }) {
  const off = disabled || busy;
  const bg = kind === 'fill' ? fill : kind === 'raised' ? color.bgRaised : kind === 'white' ? color.bgInverse : 'transparent';
  const fg = kind === 'fill' || kind === 'white' ? color.onAccent : color.fgPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [k.big, kind === 'text' && k.bigText, { backgroundColor: bg }, disabled && k.off, pressed && !off && k.pressed]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[k.bigLabel, { color: fg }, kind === 'text' && k.bigLabelText]}>{title}</Text>}
    </Pressable>
  );
}

/** Step screen: back + 7-segment bar, question headline, helper, content, CTA pinned to the bottom safe area. */
export function StepShell({
  step,
  onBack,
  title,
  sub,
  children,
  cta,
  below,
  scroll = false,
}: {
  step?: number;
  onBack?: () => void;
  title: string;
  sub?: string;
  children?: React.ReactNode;
  cta?: Cta;
  below?: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardShown();
  const Body = scroll ? ScrollView : View;
  return (
    <KeyboardAvoidingView style={k.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[k.head, { paddingTop: insets.top + space.s }]}>
        {onBack ? <BackButton onPress={onBack} /> : <View style={{ width: touch }} />}
        {step ? <StepBar step={step} /> : <View style={{ flex: 1 }} />}
      </View>
      <Body style={k.flex} contentContainerStyle={scroll ? k.bodyScroll : undefined} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Enter style={scroll ? undefined : k.flex}>
          <View style={k.body}>
            <Text style={k.title} accessibilityRole="header">
              {title}
            </Text>
            {sub ? <Text style={k.sub}>{sub}</Text> : null}
            {children}
          </View>
        </Enter>
      </Body>
      {cta || below ? (
        <View style={[k.foot, { paddingBottom: (kb ? space.m : Math.max(insets.bottom, space.l)) + space.xs }]}>
          {cta ? <BigButton {...cta} /> : null}
          {below}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** Full-width radio pill (S-03c, S-04 rows share its look). */
export function OptionPill({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [k.pill, on ? k.pillOn : null, pressed && k.pressed]}
    >
      <Text style={[k.pillLabel, on && { color: color.onAccent }]}>{label}</Text>
      <View style={[k.radio, on ? k.radioOn : null]} />
    </Pressable>
  );
}

export const ROW = 44;
const VISIBLE = 5;

/** One snap-scrolling wheel column (S-03b). Tap a row or flick; haptic tick per row. */
export function WheelColumn({ items, index, onChange, label, flex = 1 }: { items: string[]; index: number; onChange: (i: number) => void; label: string; flex?: number }) {
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const last = useRef(index);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ROW, animated: false });
    // only on mount: later changes come from the user scrolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const at = (y: number) => Math.max(0, Math.min(items.length - 1, Math.round(y / ROW)));
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = at(e.nativeEvent.contentOffset.y);
    if (i !== last.current) {
      last.current = i;
      tick();
      onChange(i);
    }
    if (Platform.OS === 'web') {
      // web has no momentum end: snap once scrolling stops
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => ref.current?.scrollTo({ y: i * ROW, animated: true }), 120);
    }
  };
  return (
    <View style={{ flex, height: ROW * VISIBLE }} accessibilityLabel={`${label}: ${items[index]}`} accessibilityRole="adjustable"
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const i = Math.max(0, Math.min(items.length - 1, index + (e.nativeEvent.actionName === 'increment' ? 1 : -1)));
        ref.current?.scrollTo({ y: i * ROW, animated: true });
        onChange(i);
      }}
    >
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{ paddingVertical: ROW * 2 }}
      >
        {items.map((it, i) => {
          const d = Math.abs(i - index);
          return (
            <Pressable key={it + i} onPress={() => ref.current?.scrollTo({ y: i * ROW, animated: true })} style={k.wheelRow} importantForAccessibility="no">
              <Text style={[k.wheelText, d === 0 ? k.wheelOn : null, { opacity: d === 0 ? 1 : d === 1 ? 0.45 : 0.2 }]} numberOfLines={1}>
                {it}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const k = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgBase },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: space.l, paddingBottom: space.s },
  back: { width: touch, height: touch, borderRadius: radius.pill, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  barRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m },
  bar: { flex: 1, flexDirection: 'row', gap: 5 },
  seg: { flex: 1, height: 6, borderRadius: radius.pill },
  count: { fontFamily: font.medium, fontSize: 13, color: color.fgSecondary, fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'right' },
  body: { paddingHorizontal: space.xxl, paddingTop: space.xxxl, gap: 14, flexGrow: 1 },
  bodyScroll: { flexGrow: 1, paddingBottom: space.xxl },
  title: { fontFamily: font.heavy, fontSize: 34, lineHeight: 38, letterSpacing: -1, color: color.fgPrimary },
  sub: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.fgSecondary },
  foot: { paddingHorizontal: space.xxl, paddingTop: space.m, gap: space.xs },
  big: { minHeight: 58, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, flexDirection: 'row', gap: 10 },
  bigText: { minHeight: 48 },
  bigLabel: { fontFamily: font.heavy, fontSize: 18, textAlign: 'center' },
  bigLabelText: { fontFamily: font.bold, fontSize: 16 },
  off: { opacity: 0.35 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  pill: { minHeight: 60, borderRadius: radius.pill, paddingHorizontal: 22, backgroundColor: color.bgRaised, borderWidth: 2, borderColor: color.bgRaised, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pillOn: { backgroundColor: color.bgInverse, borderColor: color.bgInverse },
  pillLabel: { fontFamily: font.heavy, fontSize: 18, color: color.fgPrimary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.line },
  radioOn: { borderWidth: 7, borderColor: color.onAccent },
  wheelRow: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontFamily: font.medium, fontSize: 17, color: color.fgPrimary, fontVariant: ['tabular-nums'] },
  wheelOn: { fontFamily: font.heavy, fontSize: 22 },
});

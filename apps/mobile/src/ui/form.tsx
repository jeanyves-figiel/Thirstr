// #189 Form controls (design-system.md › Form controls): timeline scrubber, guest stepper, icon choice, icon tiles.
// One control per question instead of chip walls. Haptics follow the #187 tokens: tick per step, bump at a limit.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, type GestureResponderEvent, type HostInstance } from 'react-native';
import { feel } from './haptics';
import { hhmm, lenLabel, setEnd, slide, ticks, type Limits, type Win } from '../scene/timeWindow';
import { color, font, radius, space, type } from '../theme/tokens';

// Haptics through the app's one module (F-19 R-19.8): tick per step, tap at a limit, success on submit.
export const haptic = {
  tick: () => feel('tick'),
  bump: () => feel('tap'),
  success: () => feel('success'),
};

/** Uppercase section label with an optional value on the right. */
export function FormLabel({ label, value }: { label: string; value?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: space.xs, marginBottom: space.s }}>
      <Text style={{ ...type.caption, fontSize: 12, lineHeight: 16, color: color.fgMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
      {value ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{value}</Text> : null}
    </View>
  );
}

type TRProps = {
  limits: Limits;
  value: Win;
  onChange: (w: Win) => void;
  accent: string;
  /** Label for the domain start when the window starts there (e.g. "Now"). */
  nowLabel?: string;
  hint: string;
  labels: { start: string; end: string; h: string; min: string };
  testID?: string;
};

const KNOB = 28;
const TRACK_H = 64;

/** Timeline scrubber (#189 option A): drag an end to set start or end, drag the middle to move the whole window. 15 min snap. */
export function TimeRange({ limits, value, onChange, accent, nowLabel, hint, labels, testID }: TRProps) {
  const [w, setW] = useState(0);
  const drag = useRef<{ mode: 's' | 'e' | 'mv'; x0: number; w0: Win } | null>(null);
  const track = useRef<HostInstance>(null);
  const left = useRef(0);
  const last = useRef(value);
  useEffect(() => {
    last.current = value;
  }, [value]);
  const span = limits.max - limits.min;
  const inner = Math.max(1, w - KNOB);
  const toX = (t: number) => KNOB / 2 + ((t - limits.min) / span) * inner;
  const toT = (dx: number) => (dx / inner) * span;

  const emit = (n: Win) => {
    const p = last.current;
    if (n.s === p.s && n.e === p.e) return;
    // Bump when the window hits a limit, tick otherwise.
    const atLimit = n.s === limits.min || n.e === limits.max || n.e - n.s === limits.maxLen || n.e - n.s === limits.minLen;
    (atLimit ? haptic.bump : haptic.tick)();
    onChange(n);
  };

  const grant = (e: GestureResponderEvent) => {
    track.current?.measureInWindow((x: number) => (left.current = x));
    // pageX minus the track's window x: locationX is relative to whichever child was hit.
    const x = e.nativeEvent.pageX - left.current;
    const xs = toX(value.s);
    const xe = toX(value.e);
    let mode: 's' | 'e' | 'mv';
    if (Math.abs(x - xs) <= KNOB && Math.abs(x - xs) <= Math.abs(x - xe)) mode = 's';
    else if (Math.abs(x - xe) <= KNOB) mode = 'e';
    else if (x > xs && x < xe) mode = 'mv';
    else {
      // Tap outside the window: move the nearest end there.
      mode = Math.abs(x - xs) < Math.abs(x - xe) ? 's' : 'e';
      emit(setEnd(value, mode, limits.min + toT(x - KNOB / 2), limits));
    }
    drag.current = { mode, x0: e.nativeEvent.pageX, w0: last.current };
  };
  const move = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = toT(e.nativeEvent.pageX - d.x0);
    if (d.mode === 'mv') emit(slide(d.w0, d.w0.s + dt, limits));
    else emit(setEnd(d.w0, d.mode, (d.mode === 's' ? d.w0.s : d.w0.e) + dt, limits));
  };

  const startLabel = value.s === limits.min && nowLabel ? nowLabel : hhmm(value.s);
  const len = lenLabel(value.e - value.s, labels.h, labels.min);
  const nudge = (which: 's' | 'e', dir: 1 | -1) => emit(setEnd(value, which, (which === 's' ? value.s : value.e) + dir * 15 * 60_000, limits));
  const marks = ticks(limits);

  useEffect(() => () => void (drag.current = null), []);

  return (
    <View style={{ backgroundColor: color.bgRaised, borderRadius: radius.md, padding: space.m + 2, paddingBottom: space.s + 2, gap: space.s + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
        <Text style={{ fontFamily: font.heavy, fontSize: 26, lineHeight: 32, letterSpacing: -0.8, color: color.fgPrimary, fontVariant: ['tabular-nums'] }}>
          {startLabel}
          <Text style={{ fontFamily: font.medium, color: color.fgMuted }}>{'  →  '}</Text>
          {hhmm(value.e)}
        </Text>
        <View style={{ marginLeft: 'auto', backgroundColor: color.bgBase, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
          <Text style={{ ...type.meta, fontFamily: font.bold, color: color.fgSecondary }}>{len}</Text>
        </View>
      </View>
      <View
        testID={testID}
        ref={track}
        onLayout={(e) => {
          setW(e.nativeEvent.layout.width);
          track.current?.measureInWindow((x: number) => (left.current = x));
        }}
        style={{ height: TRACK_H }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={grant}
        onResponderMove={move}
        onResponderRelease={() => {
            drag.current = null;
          }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${labels.start} ${startLabel}, ${labels.end} ${hhmm(value.e)}`}
        accessibilityValue={{ text: `${startLabel} – ${hhmm(value.e)}, ${len}` }}
        accessibilityActions={[
          { name: 'increment', label: `${labels.end} +15 ${labels.min}` },
          { name: 'decrement', label: `${labels.end} −15 ${labels.min}` },
          { name: 'startLater', label: `${labels.start} +15 ${labels.min}` },
          { name: 'startEarlier', label: `${labels.start} −15 ${labels.min}` },
        ]}
        onAccessibilityAction={(e) => {
          const a = e.nativeEvent.actionName;
          if (a === 'increment') nudge('e', 1);
          else if (a === 'decrement') nudge('e', -1);
          else if (a === 'startLater') nudge('s', 1);
          else if (a === 'startEarlier') nudge('s', -1);
        }}
      >
        {w ? (
          <View pointerEvents="none" style={{ flex: 1 }}>
            {marks.map((m) => (
              <View
                key={m.t}
                style={{ position: 'absolute', left: toX(m.t) - 0.75, top: m.major ? 10 : 20, width: 1.5, height: m.major ? 20 : 10, borderRadius: 1, backgroundColor: m.major ? color.navInactive : color.line }}
              />
            ))}
            <View
              style={{
                position: 'absolute',
                top: 6,
                height: 38,
                left: toX(value.s),
                width: Math.max(0, toX(value.e) - toX(value.s)),
                borderRadius: 12,
                borderWidth: 2,
                borderColor: accent,
                backgroundColor: `${accent}38`,
              }}
            />
            {[value.s, value.e].map((t, i) => (
              <View key={i} style={{ position: 'absolute', top: 2, left: toX(t) - 8, width: 16, height: 46, borderRadius: 9, backgroundColor: color.bgInverse, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2, shadowColor: color.shadow, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
                <View style={{ width: 2, height: 14, borderRadius: 1, backgroundColor: accent }} />
                <View style={{ width: 2, height: 14, borderRadius: 1, backgroundColor: accent }} />
              </View>
            ))}
            {nowLabel ? <View style={{ position: 'absolute', top: -3, left: toX(limits.min) - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} /> : null}
            {nowLabel ? <Text style={{ position: 'absolute', bottom: 0, left: 0, fontSize: 11, fontFamily: font.bold, color: accent }}>{nowLabel.toLowerCase()}</Text> : null}
            {marks
              .filter((m) => m.label)
              .map((m) => (
                <Text key={`l${m.t}`} style={{ position: 'absolute', bottom: 0, left: toX(m.t) - 16, width: 32, textAlign: 'center', fontSize: 11, fontFamily: font.bold, color: color.fgMuted }}>
                  {`${hhmm(m.t).slice(0, 2)}h`}
                </Text>
              ))}
          </View>
        ) : null}
      </View>
      <Text style={{ fontSize: 12, fontFamily: font.medium, color: color.fgMuted, textAlign: 'center' }}>{hint}</Text>
    </View>
  );
}

/** Guest count: − / + (hold to repeat) or drag the number sideways; seat dots show the size. */
export function Stepper({ value, min, max, onChange, accent, sub, labels, testID }: { value: number; min: number; max: number; onChange: (n: number) => void; accent: string; sub: string; labels: { less: string; more: string; name: string }; testID?: string }) {
  const cur = useRef(value);
  useEffect(() => {
    cur.current = value;
  }, [value]);
  const set = (n: number) => {
    const v = Math.max(min, Math.min(max, n));
    if (v === cur.current) return;
    (v === min || v === max ? haptic.bump : haptic.tick)();
    cur.current = v;
    onChange(v);
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const hold = (d: 1 | -1) => {
    set(cur.current + d);
    const rep = (ms: number) => (timer.current = setTimeout(() => (set(cur.current + d), rep(Math.max(50, ms * 0.85))), ms));
    rep(380);
  };
  const drag = useRef<{ x0: number; v0: number } | null>(null);
  const dot = value > 30 ? 7 : value > 15 ? 9 : 12;
  const btn = (d: 1 | -1, label: string) => (
    <Pressable
      onPressIn={() => hold(d)}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={d < 0 ? value <= min : value >= max}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, backgroundColor: color.bgBase, alignItems: 'center', justifyContent: 'center', opacity: (d < 0 ? value <= min : value >= max) ? 0.4 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}
    >
      <Text style={{ fontFamily: font.heavy, fontSize: 26, lineHeight: 30, color: color.fgPrimary }}>{d < 0 ? '−' : '+'}</Text>
    </Pressable>
  );
  return (
    <View style={{ backgroundColor: color.bgRaised, borderRadius: radius.md, padding: space.m + 2, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        {btn(-1, labels.less)}
        <View
          testID={testID}
          style={{ flex: 1, alignItems: 'center' }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => {
            drag.current = { x0: e.nativeEvent.pageX, v0: cur.current };
          }}
          onResponderMove={(e) => {
            if (drag.current) set(drag.current.v0 + Math.round((e.nativeEvent.pageX - drag.current.x0) / 12));
          }}
          onResponderRelease={() => {
            drag.current = null;
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={labels.name}
          accessibilityValue={{ min, max, now: value }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => set(cur.current + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
        >
          <Text style={{ fontFamily: font.heavy, fontSize: 44, lineHeight: 48, letterSpacing: -1.5, color: color.fgPrimary, fontVariant: ['tabular-nums'] }}>{value}</Text>
          <Text style={{ ...type.caption, fontFamily: font.bold, fontSize: 12, color: color.fgMuted }}>{sub}</Text>
        </View>
        {btn(1, labels.more)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color.bgInverse }} />
        {Array.from({ length: value }, (_, i) => (
          <View key={i} style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: accent }} />
        ))}
      </View>
    </View>
  );
}

export type IconOption<T extends string> = { value: T; label: string; icon: (c: string) => React.ReactNode };

/** One choice among a few, each with an icon (plan type, audience). Stacked = icon over label; row = side by side. */
export function IconChoice<T extends string>({ options, value, onChange, fill, row, label, testID }: { options: IconOption<T>[]; value: T; onChange: (v: T) => void; fill: string; row?: boolean; label: string; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 6, backgroundColor: color.bgRaised, borderRadius: 20, padding: 5 }}>
      {options.map((o) => {
        const sel = o.value === value;
        const c = sel ? color.onAccent : color.fgSecondary;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            onPress={() => {
              if (!sel) haptic.tick();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: sel }}
            accessibilityLabel={o.label}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: row ? 44 : 60,
              borderRadius: 15,
              paddingHorizontal: 2,
              paddingVertical: row ? 10 : 8,
              backgroundColor: sel ? fill : 'transparent',
              flexDirection: row ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: row ? 7 : 4,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            {o.icon(c)}
            <Text numberOfLines={2} style={{ fontFamily: font.bold, fontSize: row ? 13 : 11.5, lineHeight: row ? 17 : 14, color: c, textAlign: 'center' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Multi-select icon tiles, 4 per row (house rules). */
export function IconTiles<T extends string>({ options, selected, onToggle, fill, testID }: { options: IconOption<T>[]; selected: string[]; onToggle: (v: T) => void; fill: string; testID?: string }) {
  const [w, setW] = useState(0);
  const gap = space.s;
  const size = w ? (w - gap * 3) / 4 : 0;
  return (
    <View testID={testID} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {size
        ? options.map((o) => {
            const sel = selected.includes(o.value);
            const c = sel ? color.onAccent : color.fgSecondary;
            return (
              <Pressable
                key={o.value}
                testID={testID ? `${testID}-${o.value}` : undefined}
                onPress={() => {
                  haptic.tick();
                  onToggle(o.value);
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: sel }}
                accessibilityLabel={o.label}
                style={({ pressed }) => ({ width: size, height: size, borderRadius: 18, backgroundColor: sel ? fill : color.bgRaised, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 4, transform: [{ scale: pressed ? 0.93 : 1 }] })}
              >
                {sel ? <View style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 4, backgroundColor: color.onAccent }} /> : null}
                {o.icon(c)}
                <Text numberOfLines={2} style={{ fontFamily: font.bold, fontSize: 11, lineHeight: 13, color: c, textAlign: 'center' }}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

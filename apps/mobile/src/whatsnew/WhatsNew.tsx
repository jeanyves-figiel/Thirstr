import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import app from '../../app.json';
import { wn, wnLang } from '../i18n/whatsnew';
import { color, font, motion, radius, space, type } from '../theme/tokens';
import { afterSheet, Button, Sheet } from '../ui';
import { langOf, pickNote } from './logic';
import { NOTES, type Glyph, type Note, type NoteLine, type Target, type Tone } from './notes';

// F-17 R-17.15 (#238), S-78/S-79: What's new card (once per note, after an update), full list sheet and history.
// Local only: the notes ship in the app; the one value stored is the last seen note id.
export const SEEN_KEY = 'thirstr.whatsNewSeen';
const PREFS_KEY = 'thirstr.prefs'; // exists on every phone that ran an earlier version (upgrade, not fresh install)
const DELAY_MS = 1200;
const lang = langOf(wnLang);

const tone: Record<Tone, string> = { hookup: color.hookup, friends: color.friends, sport: color.sport, trust: color.trust, travel: color.travel, personal: color.personal };
const tint = (c: string) => `${c}26`; // 15 % of the line colour on ink

const glyphs: Record<Glyph, string[]> = {
  moments: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18', 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8'],
  flame: ['M12 3c2 3 5 4 5 8a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-7z'],
  check: ['M5 12l4 4L19 6'],
  shield: ['M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z'],
  hand: ['M8 13V5.5a1.5 1.5 0 0 1 3 0V11', 'M11 10V4.5a1.5 1.5 0 0 1 3 0V11', 'M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15l-.8-2.4a1.5 1.5 0 0 1 2.7-1.2L8 14'],
  plane: ['M10 14L3 11l1.5-1.5 6.5 1 4.5-4.5a2 2 0 0 1 3 3L14 13.5l1 6.5L13.5 21.5 10.5 15'],
  pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'M12 7.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4'],
  video: ['M4 7h11v10H4z', 'M15 10l5-3v10l-5-3'],
  pen: ['M4 20h4L19 9l-4-4L4 16z'],
  spark: ['M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6'],
};

function GlyphTile({ line }: { line: NoteLine }) {
  const c = tone[line.tone];
  return (
    <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(c) }}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        {glyphs[line.glyph].map((d) => (
          <Path key={d} d={d} />
        ))}
      </Svg>
    </View>
  );
}

function Line({ line, onOpen, pressBg = color.bgRaised }: { line: NoteLine; onOpen?: (t: Target) => void; pressBg?: string }) {
  const [title, sub] = line.text[lang];
  const go = line.to && onOpen ? () => onOpen(line.to!) : undefined;
  return (
    <Pressable
      disabled={!go}
      onPress={go}
      accessibilityRole={go ? 'button' : 'text'}
      accessibilityLabel={go ? wn.open(`${title}. ${sub}`) : `${title}. ${sub}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 16, backgroundColor: pressed ? pressBg : 'transparent' })}
    >
      <GlyphTile line={line} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, fontFamily: font.bold, fontSize: 15, color: color.fgPrimary }}>{title}</Text>
        <Text style={{ ...type.meta, fontFamily: font.regular, color: color.fgSecondary }}>{sub}</Text>
      </View>
      {go ? (
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color.fgMuted} strokeWidth={2.4} strokeLinecap="round">
          <Path d="M9 6l6 6-6 6" />
        </Svg>
      ) : null}
    </Pressable>
  );
}

function Dots() {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[color.personal, color.friends, color.sport].map((c) => (
        <Svg key={c} width={6} height={6}>
          <Circle cx={3} cy={3} r={3} fill={c} />
        </Svg>
      ))}
    </View>
  );
}

const AUTO_CLOSE_MS = 12000;
const HEADER = 56 + space.xs + space.s; // Explore header pill (LiveHeader) + its padding

function Spark() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Defs>
        <LinearGradient id="wn-spark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color.hookup} />
          <Stop offset="0.55" stopColor={color.friends} />
          <Stop offset="1" stopColor={color.sport} />
        </LinearGradient>
      </Defs>
      <Rect width={34} height={34} rx={11} fill="url(#wn-spark)" />
      <Path d="M17 8v4M17 22v4M8 17h4M22 17h4M11 11l2.5 2.5M20.5 20.5 23 23M11 23l2.5-2.5M20.5 13.5 23 11" stroke={color.onAccent} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/**
 * Option B (#238, picked 2026-11-21): small card under the Explore header, no scrim, map stays usable.
 * Shown once per note when `ready` (Explore on top, nothing else open) holds for 1.2 s.
 * Tap → full list (sheet); ✕, swipe up or 12 s untouched → closes. Any close marks the note seen.
 */
export function WhatsNewCard({ ready, onOpen, onHistory }: { ready: boolean; onOpen: (t: Target) => void; onHistory: () => void }) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [pending, setPending] = useState<{ note: Note; earlier: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const y = useSharedValue(-16);
  const op = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    Promise.all([AsyncStorage.getItem(SEEN_KEY), AsyncStorage.getItem(PREFS_KEY)])
      .then(([seen, prefs]) => {
        const last = seen != null && Number.isFinite(Number(seen)) ? Number(seen) : null;
        const r = pickNote(last, prefs != null);
        if (r.note && alive) setPending({ note: r.note, earlier: r.earlier });
        // Fresh install / nothing new: remember the newest id so this build never shows a card later.
        else if (last !== r.latest) AsyncStorage.setItem(SEEN_KEY, String(r.latest)).catch(() => {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Appear on a quiet Explore; hide (not dismissed) if Explore stops being quiet.
  useEffect(() => {
    if (!pending || sheet || !ready) return;
    const t = setTimeout(() => setArmed(true), DELAY_MS);
    return () => {
      clearTimeout(t);
      setArmed(false);
    };
  }, [pending, sheet, ready]);
  const card = armed && ready && !sheet && !!pending;

  const finish = useCallback(
    (then?: () => void) => {
      setArmed(false);
      setSheet(false);
      setPending(null);
      AsyncStorage.setItem(SEEN_KEY, String(NOTES[0]?.id ?? 0)).catch(() => {});
      if (then) then();
    },
    [],
  );

  useEffect(() => {
    if (!card) return;
    y.set(reduce ? 0 : withTiming(0, { duration: motion.base }));
    op.set(withTiming(1, { duration: motion.base }));
    const t = setTimeout(() => finish(), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [card, reduce, y, op, finish]);

  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      y.set(Math.min(0, e.translationY));
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY < -24 || e.velocityY < -400) scheduleOnRN(finish);
      else y.set(withTiming(0, { duration: motion.fast }));
    },
  });
  const style = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ translateY: y.get() }] }));

  if (!pending) return null;
  const { note, earlier } = pending;
  const n = note.lines.length;
  return (
    <>
      {card ? (
        <GestureDetector gesture={pan}>
          <Animated.View testID="whats-new-card" style={[{ position: 'absolute', top: insets.top + HEADER, left: 12, right: 12, zIndex: 20 }, style]}>
            <View style={{ borderRadius: 20, backgroundColor: color.bgBase, borderWidth: 1.5, borderColor: color.line, paddingVertical: 10, paddingLeft: space.m, paddingRight: 10, gap: space.s, shadowColor: color.shadow, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable
                  testID="whats-new-more"
                  onPress={() => {
                    setArmed(false);
                    setSheet(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${wn.newIn(app.expo.version)}. ${wn.things(n)}`}
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Spark />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.headline, fontSize: 14, lineHeight: 18, color: color.fgPrimary }}>{wn.newIn(app.expo.version)}</Text>
                    <Text style={{ ...type.meta, fontSize: 12, lineHeight: 16, color: color.fgSecondary }}>{wn.things(n)}</Text>
                  </View>
                </Pressable>
                <Pressable testID="whats-new-close" onPress={() => finish()} accessibilityRole="button" accessibilityLabel={wn.close} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color.fgSecondary} strokeWidth={3} strokeLinecap="round">
                    <Path d="M6 6l12 12M18 6 6 18" />
                  </Svg>
                </Pressable>
              </View>
              <Pressable
                onPress={() => {
                  setArmed(false);
                  setSheet(true);
                }}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
                style={{ gap: 6, paddingHorizontal: 2, paddingBottom: 2 }}
              >
                {note.lines.slice(0, 3).map((l, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone[l.tone] }} />
                    <Text numberOfLines={1} style={{ flex: 1, ...type.meta, fontFamily: font.regular, fontSize: 12.5, lineHeight: 17, color: color.fgSecondary }}>
                      <Text style={{ fontFamily: font.bold, color: color.fgPrimary }}>{l.text[lang][0]}</Text>
                      {`: ${l.text[lang][1]}`}
                    </Text>
                  </View>
                ))}
              </Pressable>
            </View>
          </Animated.View>
        </GestureDetector>
      ) : null}
      <Sheet visible={sheet} onClose={() => finish()} title={wn.title} closeLabel={wn.gotIt}>
        <View testID="whats-new" style={{ gap: space.m, marginTop: -space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Dots />
            <Text style={{ ...type.caption, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: color.fgMuted }}>{wn.version(app.expo.version)}</Text>
          </View>
          <View style={{ gap: space.xs }}>
            {note.lines.map((l, i) => (
              <Line key={i} line={l} onOpen={(to) => finish(() => afterSheet(() => onOpen(to)))} />
            ))}
          </View>
          <Button title={wn.gotIt} onPress={() => finish()} testID="whats-new-ok" />
          <Pressable onPress={() => finish(() => afterSheet(onHistory))} accessibilityRole="link" hitSlop={8}>
            <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center' }}>{earlier ? `${wn.earlier(earlier)} · ` : ''}{wn.findAgain}</Text>
          </Pressable>
        </View>
      </Sheet>
    </>
  );
}

const fmtDate = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(wnLang, { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
};

/** S-79: Settings › About › What's new. Last 10 notes, newest first, lines open their screen. */
export function WhatsNewScreen({ navigation }: { navigation: { navigate: (r: string, p?: object) => void } }) {
  const notes = NOTES.slice(0, 10);
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.xl, paddingBottom: 120, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, color: color.fgPrimary }}>
        {wn.title}
      </Text>
      {notes.length ? null : <Text style={{ ...type.body, color: color.fgSecondary }}>{wn.empty}</Text>}
      {notes.map((n, i) => (
        <View key={n.id} style={{ gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, marginHorizontal: space.xs }}>
            <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: color.fgMuted }}>{fmtDate(n.date)}</Text>
            {i === 0 ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.hookup }}>
                <Text style={{ ...type.caption, fontSize: 10, color: color.onAccent }}>{wn.isNew}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, padding: space.xs }}>
            {n.lines.map((l, j) => (
              <Line key={j} line={l} pressBg={color.bgOverlay} onOpen={(to) => navigation.navigate(to.route, to.params)} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

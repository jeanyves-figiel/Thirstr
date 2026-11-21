// Date safety quick access UI (#112): live bar (S-56), quick sheet (S-57), chat shield + meetup card (S-41).
import { getLocales } from 'expo-localization';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Reanimated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useSession } from '../app/session';
import { dx } from '../i18n/date';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { Button, ErrorText, Icon, Toggle } from '../ui';
import { useDragClose } from '../ui/dragClose';
import { getLock } from './lock';
import { HoldButton } from './parts';
import { dismissCue, hhmm, leftParts, startForChat, whoText } from './quick';
import * as S from './safety';

// One shared clock so the bar, the chat pill and the sheets always show the same time left.
let clockNow = Date.now();
const clockSubs = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const tickClock = () => {
  clockNow = Date.now();
  clockSubs.forEach((cb) => cb());
};
S.onActive(() => tickClock());
function subscribeClock(cb: () => void) {
  clockSubs.add(cb);
  if (!clockTimer) clockTimer = setInterval(tickClock, 15_000);
  return () => {
    clockSubs.delete(cb);
    if (!clockSubs.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
/** Current time from the shared clock (15 s steps; keeps render pure). */
export const useNow = () => useSyncExternalStore(subscribeClock, () => clockNow);

/** Running check-in, kept in step with start / extend / OK / SOS / server sync. */
export function useCheckin() {
  const [a, setA] = useState<S.Active | null>(null);
  useEffect(() => {
    let alive = true;
    S.active().then((x) => alive && setA(x ?? null)).catch(() => {});
    const off = S.onActive((x) => alive && setA(x));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return a;
}

/** Accepted trusted contacts' labels (device-only), for "Léa and Sam". */
export function useContactNames() {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    S.contacts()
      .then((l) => setNames(l.filter((c) => c.accepted).map((c) => c.label)))
      .catch(() => setNames([]));
  }, []);
  return names;
}

const leftText = (due: string, now: number) => {
  const p = leftParts(due, now);
  return dx.left(p.h, p.m);
};

function Pulse({ c = color.trust, size = 36, children }: { c?: string; size?: number; children: React.ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: c, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }] }}
      />
      {children}
    </View>
  );
}

/** S-56 live bar: top of the app on every screen while a check-in runs (R-13.16). */
export function LiveBar({ a, onOpen }: { a: S.Active; onOpen: (late: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const names = useContactNames();
  const now = useNow();
  const late = new Date(a.due).getTime() <= now;
  const fill = late ? color.danger : color.trust;
  const sub = late ? dx.barLateSub(hhmm(new Date(a.due).getTime() + 15 * 60_000)) : a.peer ? dx.barSubWith(hhmm(a.due), a.peer) : dx.barSub(hhmm(a.due), whoText(names ?? [], dx.and, dx.yourContacts));
  const title = late ? dx.barLate : dx.bar(leftText(a.due, now));
  return (
    <Pressable
      testID="live-bar"
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={() => onOpen(late)}
      style={({ pressed }) => ({ backgroundColor: fill, paddingTop: insets.top + space.xs, paddingBottom: space.s, paddingHorizontal: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m, opacity: pressed ? 0.9 : 1 })}
    >
      <Pulse c={color.onAccent} size={34}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color.onAccent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Shield size={18} c={fill} w={2.4} />
        </View>
      </Pulse>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ ...type.headline, fontSize: 15, color: color.onAccent }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, fontFamily: font.bold, color: color.onAccent, opacity: 0.78 }}>
          {sub}
        </Text>
      </View>
      <View style={{ height: 32, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: color.onAccent, justifyContent: 'center' }}>
        <Text style={{ ...type.caption, fontSize: 13, color: fill }}>{dx.open}</Text>
      </View>
    </Pressable>
  );
}

/** Bottom-sheet frame for sheet screens (S-51 v2, S-57): fading scrim, spring sheet, handle. */
export function SheetFrame({ onClose, children, testID }: { onClose: () => void; children: React.ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const [v] = useState(() => new Animated.Value(0));
  const closing = useRef(false);
  useEffect(() => {
    Animated.spring(v, { toValue: 1, damping: 20, stiffness: 180, useNativeDriver: true }).start();
  }, [v]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(v, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onClose());
  }, [v, onClose]);
  const drag = useDragClose(onClose);
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.scrim, opacity: v }}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityRole="button" accessibilityLabel={tx.common.close} />
      </Animated.View>
      <Reanimated.View style={[{ maxHeight: '90%' }, drag.sheetStyle]} onLayout={drag.onLayout}>
      <Animated.View
        testID={testID}
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        style={{ maxHeight: '100%', backgroundColor: color.bgRaised, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }}
      >
        {/* F-19 G15 (#187): drag the handle down to close. */}
        <GestureDetector gesture={drag.pan}>
          <View style={{ alignItems: 'center', paddingTop: space.s, paddingBottom: space.s }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: color.line }} />
          </View>
        </GestureDetector>
        <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.s, paddingBottom: insets.bottom + space.xxl, gap: space.l }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </Animated.View>
      </Reanimated.View>
    </View>
  );
}

function Ring({ a }: { a: S.Active }) {
  const now = useNow();
  const total = Math.max(60_000, new Date(a.due).getTime() - new Date(a.started ?? a.due).getTime());
  const p = leftParts(a.due, now);
  const frac = Math.min(1, p.ms / total);
  const r = 27;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={dx.shieldLive(dx.left(p.h, p.m))}>
      <Svg width={64} height={64} viewBox="0 0 64 64" style={{ position: 'absolute' }}>
        <Circle cx={32} cy={32} r={r} fill="none" stroke={color.line} strokeWidth={6} />
        <Circle cx={32} cy={32} r={r} fill="none" stroke={color.trust} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 32 32)" />
      </Svg>
      <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary, fontVariant: ['tabular-nums'] }}>{dx.left(p.h, p.m)}</Text>
    </View>
  );
}

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void; replace?: (s: string, p?: object) => void };

/** S-57 Safety quick sheet (R-13.17). */
export function SafetyQuickScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const a = useCheckin();
  const names = useContactNames();
  const [busy, setBusy] = useState<'ok' | 'more' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const seen = useRef(false);
  const gone = useRef(false);
  // One way out only: OK here also clears the check-in, which the effect below sees too.
  const close = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    navigation.goBack();
  }, [navigation]);
  // Ended elsewhere (OK on another device, alert fired): nothing left to show.
  useEffect(() => {
    if (a) seen.current = true;
    else if (seen.current && !sent) close();
  }, [a, sent, close]);

  const ok = async () => {
    const lock = await getLock().catch(() => null);
    // With app lock the PIN pad stays in the path so the duress PIN still works (R-13.9).
    if (lock) return navigation.replace ? navigation.replace('CheckinDue') : navigation.navigate('CheckinDue');
    setBusy('ok');
    await S.okCheckin().catch(() => {});
    setBusy(null);
    close();
  };
  const more = async () => {
    setErr(null);
    setBusy('more');
    try {
      await S.extendCheckin();
    } catch (e) {
      setErr((e as { code?: string }).code === 'max_extensions' ? tx.safety.maxExt : tx.common.error);
    } finally {
      setBusy(null);
    }
  };
  const sos = () => {
    setErr(null);
    S.panic(me.profile?.display_name ?? 'Me').then(
      () => setSent(true),
      () => setErr(tx.common.error),
    );
  };
  const n = S.emergencyNumber(getLocales()[0]?.regionCode);
  const who = whoText(names ?? [], dx.and, dx.yourContacts);

  return (
    <SheetFrame onClose={close} testID="safety-quick">
      {sent ? (
        <>
          <Text accessibilityRole="header" style={{ ...type.title, color: color.danger }}>
            {tx.safety.sosSent}
          </Text>
          <Button testID="quick-call" kind="danger" title={tx.safety.call(n)} onPress={() => Linking.openURL(`tel:${n}`).finally(close)} />
          <Button kind="ghost" title={tx.safety.callNo} onPress={close} />
        </>
      ) : a ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.l }}>
            <Ring a={a} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
                {a.peer ? dx.dateWith(a.peer) : dx.running}
              </Text>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{dx.due(hhmm(a.due))}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Button testID="quick-ok" kind="trust" title={tx.safety.imOk} busy={busy === 'ok'} onPress={ok} />
            </View>
            {a.ext < 3 ? (
              <View style={{ flex: 1 }}>
                <Button testID="quick-more" kind="secondary" title={dx.more} busy={busy === 'more'} onPress={more} />
              </View>
            ) : null}
          </View>
          <View style={{ backgroundColor: color.bgBase, borderRadius: radius.md, paddingHorizontal: space.l, paddingVertical: space.xs }}>
            <Toggle label={dx.liveShort} sub={dx.liveSub(who, names?.length ?? 0)} value={a.live} tone={color.trust} onChange={(v) => S.setLive(v).catch(() => {})} />
          </View>
          <HoldButton testID="quick-sos" label={tx.safety.sos} badge="SOS" sub={tx.safety.sosHold} ms={2000} onDone={sos} />
          <ErrorText text={err} />
          {a.cid && a.peer ? (
            <Button
              kind="ghost"
              title={dx.openChat(a.peer)}
              onPress={() => {
                close();
                navigation.navigate('Chat', { cid: a.cid });
              }}
            />
          ) : null}
        </>
      ) : (
        <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.common.loading}</Text>
      )}
    </SheetFrame>
  );
}

/** S-41 header shield (R-13.14): outlined when idle, teal pill with time left while a check-in runs. */
export function ChatShield({ cid, navigation }: { cid: string; navigation: Nav }) {
  const a = useCheckin();
  const now = useNow();
  // Running: same size as idle (the live bar above already shows the time left), filled teal.
  if (a)
    return (
      <Pressable
        testID="chat-shield-live"
        accessibilityRole="button"
        accessibilityLabel={dx.shieldLive(leftText(a.due, now))}
        hitSlop={2}
        onPress={() => navigation.navigate('SafetyQuick')}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon.Shield size={19} c={color.onAccent} w={2.4} />
      </Pressable>
    );
  return (
    <Pressable
      testID="chat-shield"
      accessibilityRole="button"
      accessibilityLabel={dx.shield}
      onPress={() => navigation.navigate('CheckinStart', { cid })}
      hitSlop={2}
      style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: color.trust, backgroundColor: `${color.trust}1F`, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon.Shield size={18} c={color.trust} w={2.3} />
    </Pressable>
  );
}

/** R-13.18 meetup prompt card above the composer. */
export function MeetupCard({ cid, name, navigation, onHide }: { cid: string; name: string; navigation: Nav; onHide: () => void }) {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true }).start();
  }, [v]);
  const now = useNow();
  const due = hhmm(now + 120 * 60_000);
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await startForChat({ cid, minutes: 120, include: true, live: false, name: await S.myName(me.profile?.display_name ?? 'Me') });
      onHide();
    } catch (e) {
      if (e instanceof Error && e.message === 'no_contacts') navigation.navigate('CheckinStart', { cid });
      else if ((e as { code?: string }).code === 'checkin_active' && !(await S.active())) navigation.navigate('CheckinDue'); // #127
      else setErr(tx.common.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Animated.View
      testID="meetup-card"
      style={{ marginHorizontal: space.l, marginBottom: space.s, padding: space.l, borderRadius: radius.tray, backgroundColor: color.bgRaised, borderWidth: 1, borderColor: `${color.trust}73`, gap: space.m, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}
    >
      <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: `${color.trust}2E`, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Shield size={22} c={color.trust} w={2.3} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{dx.cueTitle(name)}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{dx.cueBody}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Button testID="meetup-start" small kind="trust" title={dx.cueStart(due)} busy={busy} onPress={start} />
        </View>
        <Button
          testID="meetup-later"
          small
          kind="secondary"
          title={dx.cueLater}
          onPress={() => {
            dismissCue(cid).catch(() => {});
            onHide();
          }}
        />
      </View>
      <ErrorText text={err} />
      <Text style={{ ...type.caption, fontFamily: font.bold, color: color.fgMuted }}>{dx.cueNote}</Text>
    </Animated.View>
  );
}


// F-01 R-01.7 recovery phrase + sealed backup (#25, mockup option B): offer → intro → words → quick check → done,
// and the "On" management page (make new words, turn off). Words live only in this screen's state.
import * as Haptics from 'expo-haptics';
import * as ScreenCapture from 'expo-screen-capture';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { api, ApiError } from '../api/client';
import * as R from '../auth/recovery';
import { tx } from '../i18n/app';
import { rx } from '../i18n/recovery';
import { BigButton, Enter, StepShell } from '../onboarding/kit';
import { deviceAuth } from '../safety/lock';
import { color, font, radius, space } from '../theme/tokens';
import { ErrorText, Icon } from '../ui';
import { toast } from '../ui/Toast';
import { Group, Page, Row } from './settings/parts';

type Step = 'offer' | 'intro' | 'words' | 'quiz' | 'done';
type Status = { on: boolean; since: string | null; backup_at: string | null };
type Nav = { goBack: () => void; navigate: (r: string, p?: object) => void; setParams?: (p: object) => void };

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function recoveryRowValue(s: Status | null) {
  return s == null ? undefined : s.on ? rx.onSince(day(s.since)) : rx.off;
}

export function RecoveryScreen({ navigation, route }: { navigation: Nav; route: { params?: { offer?: boolean } } }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<Step | null>(route.params?.offer ? 'offer' : null);
  const load = useCallback(() => {
    api<Status>('GET', '/me/recovery').then(setStatus, () => setStatus({ on: false, since: null, backup_at: null }));
  }, []);
  useFocusEffect(load);
  if (step) return <Setup step={step} setStep={setStep} onClose={() => (load(), setStep(null), step === 'offer' || step === 'done' ? navigation.goBack() : undefined)} />;
  if (!status) return <Page title={rx.manageTitle} loading />;
  if (!status.on) return <Setup step="intro" setStep={setStep} onClose={() => navigation.goBack()} />;
  return <Manage status={status} onNew={() => setStep('intro')} onOff={async () => (await R.turnOff(), navigation.goBack())} />;
}

function Manage({ status, onNew, onOff }: { status: Status; onNew: () => void; onOff: () => Promise<unknown> }) {
  const [err, setErr] = useState<string | null>(null);
  const guard = (fn: () => unknown) => async () => {
    setErr(null);
    if (!(await deviceAuth(rx.manageFace))) return;
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    }
  };
  return (
    <Page title={rx.manageTitle} err={err}>
      <Group>
        <Row title={rx.since} value={day(status.since)} chevron={false} valueTone={color.trust} />
        <Row title={rx.backup} value={status.backup_at ? rx.backupAt(when(status.backup_at)) : rx.backupNone} chevron={false} />
      </Group>
      <Group>
        <Row testID="recovery-new" title={rx.newWords} sub={rx.newWordsSub} onPress={guard(onNew)} />
        <Row testID="recovery-off" title={rx.turnOff} sub={rx.turnOffSub} danger chevron={false} onPress={guard(onOff)} />
      </Group>
    </Page>
  );
}

function Setup({ step, setStep, onClose }: { step: Step; setStep: (s: Step | null) => void; onClose: () => void }) {
  const [words, setWords] = useState<string[] | null>(null);
  const [q, setQ] = useState<ReturnType<typeof R.quiz> | null>(null);
  const [qi, setQi] = useState(0);
  const [wrong, setWrong] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Screenshot while the words are on screen → warn (they'd land in Photos and iCloud).
  useEffect(() => {
    if (step !== 'words' || Platform.OS === 'web') return;
    const sub = ScreenCapture.addScreenshotListener(() => toast(rx.shot));
    return () => sub.remove();
  }, [step]);

  const show = async () => {
    if (!(await deviceAuth(rx.faceId))) return;
    setWords((w) => w ?? R.newWords());
    setStep('words');
  };
  const startQuiz = () => {
    setQ(R.quiz(words!));
    setQi(0);
    setWrong(null);
    setStep('quiz');
  };
  const pick = async (w: string) => {
    if (!q || !words) return;
    if (w !== words[q[qi].pos]) {
      setWrong(w);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    setWrong(null);
    if (qi < 2) return setQi(qi + 1);
    setBusy(true);
    setErr(null);
    try {
      await R.turnOn(words);
      setWords(null);
      setStep('done');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'offer')
    return (
      <StepShell title={rx.offerTitle} sub={rx.offerBody} onBack={onClose} cta={{ title: rx.offerGo, onPress: () => setStep('intro'), fill: color.trust, testID: 'recovery-offer-go' }} below={<BigButton kind="text" title={rx.notNow} onPress={onClose} />}>
        <Enter delay={80}>
          <Hero />
        </Enter>
      </StepShell>
    );

  if (step === 'intro')
    return (
      <StepShell title={rx.introTitle} onBack={onClose} scroll cta={{ title: rx.show, onPress: show, fill: color.trust, testID: 'recovery-show' }}>
        <Hero />
        <View style={s.promises}>
          <Promise n="1" t={rx.p1} s={rx.p1s} />
          <Promise n="2" t={rx.p2} s={rx.p2s} />
          <Promise n="✓" t={rx.p3} s={rx.p3s} />
          <Promise n="!" t={rx.p4} s={rx.p4s} coral />
        </View>
      </StepShell>
    );

  if (step === 'words' && words)
    return (
      <StepShell title={rx.writeTitle} sub={rx.writeSub} onBack={() => setStep('intro')} scroll cta={{ title: rx.wrote, onPress: startQuiz, fill: color.trust, testID: 'recovery-wrote' }}>
        <HoldToShow words={words} />
        <View style={s.warn}>
          <Text style={s.warnIcon}>⚠︎</Text>
          <Text style={s.warnText}>
            <Text style={s.warnStrong}>{rx.warn}</Text>
            {rx.warn2}
          </Text>
        </View>
      </StepShell>
    );

  if (step === 'quiz' && q && words) {
    const cur = q[qi];
    return (
      <StepShell title={rx.quizTitle} onBack={() => setStep('words')} below={<BigButton kind="text" title={rx.again} onPress={() => setStep('words')} />}>
        <View style={s.dots} accessibilityLabel={`${qi + 1} / 3`}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.dot, i <= qi && { backgroundColor: color.trust }]} />
          ))}
        </View>
        <Text style={s.big} accessibilityRole="header">
          #{cur.pos + 1}
        </Text>
        <View style={s.chips}>
          {cur.choices.map((w) => (
            <Pressable key={w} testID={`recovery-pick-${w}`} accessibilityRole="button" accessibilityLabel={w} onPress={busy ? undefined : () => pick(w)} style={({ pressed }) => [s.chip, wrong === w && s.chipWrong, pressed && { opacity: 0.7 }]}>
              <Text style={[s.chipText, wrong === w && { color: color.hookup }]}>{w}</Text>
            </Pressable>
          ))}
        </View>
        {wrong ? <Text style={s.wrong}>{rx.wrong}</Text> : null}
        <ErrorText text={err} />
      </StepShell>
    );
  }

  return (
    <StepShell title={rx.doneTitle} sub={rx.doneSub} cta={{ title: rx.done, onPress: onClose, fill: color.bgInverse, testID: 'recovery-done' }}>
      <Enter delay={60} style={s.okWrap}>
        <View style={s.ok}>
          <Icon.Check size={44} c={color.trust} />
        </View>
      </Enter>
    </StepShell>
  );
}

function Promise({ n, t, s: sub, coral }: { n: string; t: string; s: string; coral?: boolean }) {
  return (
    <View style={s.promise}>
      <View style={[s.pIcon, coral && { backgroundColor: 'rgba(255,107,91,0.14)' }]}>
        <Text style={[s.pIconText, coral && { color: color.hookup }]}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.pTitle}>{t}</Text>
        <Text style={s.pSub}>{sub}</Text>
      </View>
    </View>
  );
}

function Hero() {
  return (
    <View style={s.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke={color.trust} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={4} y={10} width={16} height={11} rx={3} />
        <Path d="M8 10V7a4 4 0 0 1 8 0v3M12 14.5v2.5" />
      </Svg>
    </View>
  );
}

/** Words blurred (masked) until press-and-hold; numbered because order matters. */
function HoldToShow({ words }: { words: string[] }) {
  const [shown, setShown] = useState(false);
  return (
    <Pressable
      testID="recovery-hold"
      accessibilityRole="button"
      accessibilityLabel={shown ? words.map((w, i) => `${i + 1} ${w}`).join(', ') : rx.hold}
      onPressIn={() => (setShown(true), Haptics.selectionAsync().catch(() => {}))}
      onPressOut={() => setShown(false)}
      style={s.grid}
    >
      {[0, 1, 2, 3, 4, 5].map((r) => (
        <View key={r} style={s.gridRow}>
          {[r, r + 6].map((i) => (
            <View key={i} style={s.word}>
              <Text style={s.num}>{i + 1}</Text>
              <Text style={[s.wordText, !shown && s.masked]}>{shown ? words[i] : '•'.repeat(Math.max(4, words[i].length))}</Text>
            </View>
          ))}
        </View>
      ))}
      {!shown ? (
        <View style={s.holdOver} pointerEvents="none">
          <View style={s.holdPill}>
            <Icon.Eye size={16} c={color.trust} />
            <Text style={s.holdText}>{rx.hold}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  hero: { height: 118, borderRadius: 24, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center', marginTop: space.s },
  promises: { gap: 14, marginTop: space.m },
  promise: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: color.trustTint, alignItems: 'center', justifyContent: 'center' },
  pIconText: { fontFamily: font.heavy, fontSize: 15, color: color.trust },
  pTitle: { fontFamily: font.bold, fontSize: 15, color: color.fgPrimary },
  pSub: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.fgSecondary },
  grid: { gap: 7, marginTop: space.m },
  gridRow: { flexDirection: 'row', gap: 7 },
  word: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, backgroundColor: color.bgRaised, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10 },
  num: { width: 18, textAlign: 'right', fontFamily: mono, fontSize: 11, color: color.fgMuted, fontVariant: ['tabular-nums'] },
  wordText: { fontFamily: mono, fontWeight: '700', fontSize: 15, color: color.fgPrimary },
  masked: { color: color.fgMuted, letterSpacing: 1 },
  holdOver: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  holdPill: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: color.bgOverlay, borderColor: color.trust, borderWidth: 1.5, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16 },
  holdText: { fontFamily: font.heavy, fontSize: 14, color: color.fgPrimary },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: 'rgba(255,201,60,0.1)', borderRadius: 12, padding: 10, marginTop: space.m },
  warnIcon: { color: color.warn, fontSize: 14 },
  warnText: { flex: 1, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.fgSecondary },
  warnStrong: { fontFamily: font.bold, color: color.warn },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginTop: space.m },
  dot: { width: 22, height: 5, borderRadius: 3, backgroundColor: color.line },
  big: { fontFamily: mono, fontWeight: '800', fontSize: 48, color: color.trust, textAlign: 'center', marginVertical: space.l },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { width: '48%', flexGrow: 1, height: 52, borderRadius: 14, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent' },
  chipWrong: { borderColor: color.hookup },
  chipText: { fontFamily: mono, fontWeight: '700', fontSize: 15, color: color.fgPrimary },
  wrong: { fontFamily: font.medium, fontSize: 13, color: color.hookup, textAlign: 'center', marginTop: space.m },
  okWrap: { alignItems: 'center', marginTop: space.xxl },
  ok: { width: 104, height: 104, borderRadius: 52, backgroundColor: color.trustTint, alignItems: 'center', justifyContent: 'center' },
});

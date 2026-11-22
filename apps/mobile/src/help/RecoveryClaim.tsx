import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { hx } from '../i18n/help';
import { t } from '../i18n/strings';
import { deviceAuth } from '../safety/lock';
import { devSimulate, livenessCheck, supported, type Shot } from '../screens/Verify';
import { color, font, radius, space, type } from '../theme/tokens';
import type { Step } from '../trust/liveness';
import { Loading } from '../ui';
import { hm } from './kit';
import { Cta, Pill } from './SupportScreens';

// F-22 R-22.20–R-22.26 (#178): take an account back with an identity check. No support or admin path.

type Claim = { id: string; state: 'started' | 'holding' | 'ready' | 'conflict' | 'expired' | 'cancelled' | 'completed'; hold_ends_at: string | null; attempts_left: number; method: string; mine?: boolean };
type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void; popToTop?: () => void };
const METHODS = ['apple', 'google', 'passkey', 'email'] as const;

const scroll = { style: { flex: 1, backgroundColor: color.bgBase }, contentContainerStyle: { padding: space.l, paddingTop: space.s, gap: space.xl, paddingBottom: 140, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const } };

/** Live countdown text, ticking each 30 s. */
function useLeft(iso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(i);
  }, []);
  return { text: hm(iso, now), ms: iso ? new Date(iso).getTime() - now : 0 };
}

/** Front camera + face oval while `livenessCheck` runs; resolves with the outcome. */
function SelfieCamera({ steps, onResult }: { steps: Step[]; onResult: (r: 'pass' | 'fail' | 'noface' | 'offline') => void }) {
  const cam = useRef<Shot | null>(null);
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    let live = true;
    (async () => {
      await new Promise((r) => setTimeout(r, 1000));
      const r = cam.current ? await livenessCheck(cam.current, steps, (s) => live && setPrompt(s)).catch(() => 'offline' as const) : 'offline';
      if (live) onResult(r);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <CameraView ref={(r) => void (cam.current = r as unknown as Shot)} facing="front" style={{ flex: 1 }} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 250, height: 320, borderRadius: 160, borderWidth: 6, borderColor: color.trust }} />
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 80, alignItems: 'center', padding: space.l, gap: space.s }}>
        <Text accessibilityLiveRegion="polite" style={{ fontFamily: font.heavy, fontSize: 30, lineHeight: 34, color: color.fgPrimary, textAlign: 'center' }}>
          {prompt}
        </Text>
        <Text style={{ ...type.meta, color: color.trust }}>{hx.facePrivate}</Text>
      </View>
    </View>
  );
}

/** Runs one selfie check against a claim nonce (purpose claim or cancel). `passed` is what the server gets. */
function useSelfie() {
  const [perm, askPerm] = useCameraPermissions();
  const [run, setRun] = useState<{ steps: Step[]; done: (r: 'pass' | 'fail' | 'noface' | 'offline') => void } | null>(null);
  const start = async (steps: Step[]): Promise<'pass' | 'fail' | 'noface' | 'offline' | 'nocam'> => {
    if (devSimulate) return 'pass';
    if (!supported) return 'nocam';
    if (!perm?.granted && !(await askPerm()).granted) return 'nocam';
    return new Promise((done) => setRun({ steps, done: (r) => (setRun(null), done(r)) }));
  };
  const view = run ? <SelfieCamera steps={run.steps} onResult={run.done} /> : null;
  return { start, view };
}

const Badge = ({ children, tone = color.trust }: { children: string; tone?: string }) => (
  <View style={{ alignSelf: 'flex-start', paddingHorizontal: space.m, height: 30, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: color.trustTint }}>
    <Text style={{ ...type.meta, fontFamily: font.heavy, color: tone }}>{children}</Text>
  </View>
);

const Big = ({ children }: { children: string }) => (
  <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 36, color: color.fgPrimary }}>
    {children}
  </Text>
);

/** S-84b–S-84d on the claiming phone. */
export function RecoveryClaimScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const [c, setC] = useState<Claim | null | undefined>(undefined);
  const [method, setMethod] = useState<string>(me.has_oidc ? (Platform.OS === 'android' ? 'google' : 'apple') : me.has_email ? 'email' : 'passkey');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [back, setBack] = useState<{ signed_out: number; removed_methods: string[] } | null>(null);
  const selfie = useSelfie();
  const { text: left, ms } = useLeft(c?.hold_ends_at);

  const load = useCallback(() => api<{ claim: Claim | null }>('GET', '/auth/recovery/claim').then((r) => setC(r.claim?.mine ? r.claim : null), () => setC(null)), []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t.verify.error);
    } finally {
      setBusy(false);
    }
  };

  const begin = () => act(async () => setC(await api<Claim>('POST', '/auth/recovery/claim', { method })));

  const check = () =>
    act(async () => {
      if (!c) return;
      const ch = await api<{ nonce: string; steps: Step[] }>('POST', `/auth/recovery/claim/${c.id}/challenge`);
      const r = await selfie.start(ch.steps);
      if (r === 'nocam') return setErr(t.verify.iosOnly);
      if (r === 'noface' || r === 'offline') return setErr(r === 'offline' ? t.verify.offline : t.verify.noFace);
      try {
        setC(await api<Claim>('POST', `/auth/recovery/claim/${c.id}/selfie`, { nonce: ch.nonce, passed: r === 'pass' }));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'recovery_check_failed') {
          const s = await api<Claim>('GET', `/auth/recovery/claim/${c.id}`).catch(() => null);
          if (s) setC(s);
          setErr(s && s.state === 'expired' ? hx.locked : hx.failed(s?.attempts_left ?? 0));
          return;
        }
        throw e;
      }
    });

  const complete = () =>
    act(async () => {
      if (!c) return;
      setBack(await api<{ signed_out: number; removed_methods: string[] }>('POST', `/auth/recovery/claim/${c.id}/complete`));
    });

  const cancel = () => act(async () => (c ? (await api('DELETE', `/auth/recovery/claim/${c.id}`), navigation.goBack()) : undefined));

  if (selfie.view) return selfie.view;
  if (c === undefined) return <Loading />;

  if (back) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
        <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: space.xxl }}>
          <Text style={{ fontSize: 36, color: color.onAccent, fontFamily: font.heavy }}>✓</Text>
        </View>
        <Text style={{ ...type.display, textAlign: 'center', color: color.fgPrimary }}>{hx.backInName}</Text>
        <View style={{ gap: space.s, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
          <Text style={{ ...type.body, color: color.fgPrimary }}>✓ {hx.back.account}</Text>
          <Text style={{ ...type.body, color: color.fgPrimary }}>✓ {hx.back.phones(back.signed_out)}</Text>
          {back.removed_methods.length ? <Text style={{ ...type.body, color: color.fgPrimary }}>✓ {hx.back.methods}</Text> : null}
          <Text style={{ ...type.body, color: color.fgMuted }}>✕ {hx.back.chats}</Text>
        </View>
        <Cta tone={color.trust} title={hx.addPasskey} onPress={() => navigation.navigate('AccountSettings')} />
        <Cta tone={color.personal} title={hx.newWords} onPress={() => navigation.navigate('Recovery')} />
        <Cta kind="ghost" title={hx.later} onPress={() => (navigation.popToTop ? navigation.popToTop() : navigation.goBack())} />
      </ScrollView>
    );
  }

  if (!c || c.state === 'cancelled' || c.state === 'completed') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
        <Badge>{hx.check}</Badge>
        <Big>{hx.showUs}</Big>
        <Text style={{ ...type.body, color: color.fgSecondary }}>{hx.claimFirst}</Text>
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.meta, color: color.trust }}>{hx.signedWith(hx.methods[method])}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {METHODS.map((m) => (
              <Pill key={m} testID={`claim-m-${m}`} label={hx.methods[m]} on={method === m} tone={color.trust} onPress={() => setMethod(m)} />
            ))}
          </View>
        </View>
        <Ends />
        {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
        <Cta testID="claim-start" tone={color.trust} title={hx.start} busy={busy} onPress={begin} />
      </ScrollView>
    );
  }

  if (c.state === 'conflict') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
        <Badge tone={color.danger}>{hx.check}</Badge>
        <Text style={{ ...type.body, color: color.fgPrimary }}>{hx.conflict}</Text>
        <Cta kind="ghost" title={hx.done} onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  if (c.state === 'expired') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
        <Badge tone={color.danger}>{hx.check}</Badge>
        <Text style={{ ...type.body, color: color.fgPrimary }}>{hx.locked}</Text>
        <Cta kind="ghost" title={hx.done} onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  if (c.state === 'started') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
        <Badge>{hx.signedWith(hx.methods[c.method] ?? c.method)}</Badge>
        <Big>{hx.showUs}</Big>
        <Text style={{ ...type.body, color: color.fgSecondary }}>{hx.matchNote}</Text>
        <View style={{ padding: space.l, borderRadius: radius.md, backgroundColor: color.trustTint }}>
          <Text style={{ ...type.headline, color: color.trust }}>🔒 {hx.facePrivate}</Text>
        </View>
        {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
        <Cta testID="claim-selfie" tone={color.trust} title={hx.start} busy={busy} onPress={check} />
        <Cta kind="ghost" title={hx.cancel} onPress={cancel} />
      </ScrollView>
    );
  }

  // holding / ready
  const ready = c.state === 'ready' || ms <= 0;
  return (
    <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
      <Badge>{hx.check}</Badge>
      <Big>{hx.itsYou(ready ? '0 min' : left)}</Big>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{ms > 25 * 3600e3 ? hx.unverified : ms > 3600e3 + 60e3 ? hx.hold24 : hx.hold1}</Text>
      <Ends />
      {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
      <Cta testID="claim-complete" tone={color.trust} title={hx.takeBack} busy={busy} disabled={!ready} onPress={complete} />
      <Cta kind="ghost" title={hx.cancel} onPress={cancel} />
    </ScrollView>
  );
}

function Ends() {
  return (
    <View style={{ gap: space.s, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
      <Text style={{ ...type.caption, letterSpacing: 1, textTransform: 'uppercase', color: color.fgMuted }}>{hx.whenEnds}</Text>
      {hx.ends.map((e) => (
        <Text key={e} style={{ ...type.body, color: color.fgPrimary }}>
          • {e}
        </Text>
      ))}
    </View>
  );
}

/** R-22.23: current claim for this account, refreshed when the app comes to the front. */
export function useClaim() {
  const [c, setC] = useState<Claim | null>(null);
  const load = useCallback(() => api<{ claim: Claim | null }>('GET', '/auth/recovery/claim').then((r) => setC(r.claim), () => {}), []);
  useEffect(() => {
    load();
    const s = AppState.addEventListener('change', (st) => st === 'active' && load());
    return () => s.remove();
  }, [load]);
  return { claim: c, reload: load };
}

/** Banner over every screen while a claim runs: other phones can stop it (selfie), the claiming phone sees the hold. */
export function ClaimBanner({ claim, onOpen }: { claim: Claim | null; onOpen: (mine: boolean) => void }) {
  const { text: left } = useLeft(claim?.hold_ends_at);
  if (!claim || !['holding', 'ready'].includes(claim.state)) return null;
  const mine = !!claim.mine;
  return (
    <Pressable testID="claim-banner" accessibilityRole="button" onPress={() => onOpen(mine)} style={{ marginHorizontal: space.m, marginVertical: space.xs, padding: space.m, borderRadius: radius.md, backgroundColor: mine ? color.trustTint : color.alertBg, borderWidth: 1, borderColor: mine ? color.trust : color.danger }}>
      <Text style={{ ...type.headline, color: mine ? color.trust : color.alertTitle }}>{mine ? hx.mineBanner(left) : hx.someone}</Text>
      {!mine ? <Text style={{ ...type.meta, color: color.alertBody }}>{hx.someoneSub(left)}</Text> : null}
    </Pressable>
  );
}

/** S-84c on another signed-in phone: stop a claim with device auth + the same selfie check (R-22.24). */
export function RecoveryStopScreen({ navigation, route }: { navigation: Nav; route: { params?: { id: string } } }) {
  const id = route.params?.id ?? '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const selfie = useSelfie();
  const stop = async () => {
    setErr(null);
    if (!(await deviceAuth(hx.stopIt))) return;
    setBusy(true);
    try {
      const ch = await api<{ nonce: string; steps: Step[] }>('POST', `/auth/recovery/claim/${id}/challenge`, { purpose: 'cancel' });
      const r = await selfie.start(ch.steps);
      if (r !== 'pass') return setErr(r === 'nocam' ? t.verify.iosOnly : r === 'offline' ? t.verify.offline : r === 'noface' ? t.verify.noFace : hx.failed(0).split('.')[0]);
      await api('POST', `/auth/recovery/claim/${id}/cancel`, { nonce: ch.nonce, passed: true });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t.verify.error);
    } finally {
      setBusy(false);
    }
  };
  if (selfie.view) return selfie.view;
  return (
    <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
      <Badge tone={color.danger}>{hx.check}</Badge>
      <Big>{done ? hx.stopped : hx.someone}</Big>
      {!done ? (
        <>
          <Text style={{ ...type.body, color: color.fgSecondary }}>{hx.stopNeeds}</Text>
          {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
          <Cta testID="claim-stop" tone={color.danger} title={hx.stopIt} busy={busy} onPress={stop} />
          <Cta kind="ghost" title={hx.itsMe} onPress={() => navigation.goBack()} />
        </>
      ) : (
        <Cta kind="ghost" title={hx.done} onPress={() => navigation.goBack()} />
      )}
    </ScrollView>
  );
}

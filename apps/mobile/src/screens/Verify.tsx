import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { analyzeFace, faceAvailable, matchStills, selfieMatchAvailable, type FaceReading } from '../../modules/thirstr-face';
import { api, ApiError, Me } from '../api/client';
import { rand } from '../chat/bytes';
import { t } from '../i18n/strings';
import { o } from '../i18n/onboarding';
import { STEP_OF } from '../onboarding/flow';
import { BigButton, StepShell } from '../onboarding/kit';
import { color, font, radius, space, type } from '../theme/tokens';
import { blind, type IssuerKey } from '../trust/blind';
import { ownPhotoTargets, selfieOutcome, type SelfieOutcome } from '../trust/faceMatch';
import { passes, type Step } from '../trust/liveness';
import { Banner } from '../ui';

type Challenge = { nonce: string; steps: Step[]; key: IssuerKey };
type Shot = { takePictureAsync: (o: object) => Promise<{ uri: string }> };

// DEV web build only (localhost): no camera module, so the liveness result is simulated.
const devSimulate = Platform.OS === 'web' && typeof location !== 'undefined' && location.hostname === 'localhost';
const supported = (Platform.OS === 'ios' && faceAvailable) || devSimulate;

async function drop(uri: string) {
  const { File } = await import('expo-file-system');
  try {
    new File(uri).delete();
  } catch {
    /* already gone */
  }
}

type Reading = FaceReading & { uri?: string };

/**
 * One still → numbers; the frame file is deleted as soon as it is measured (R-03.5). With `keep`, the
 * still that passes stays on disk (cache, never uploaded) for the photo match and is returned as `uri`;
 * the caller deletes it right after (R-03.2, #232).
 */
async function frame(cam: Shot, ok: (r: FaceReading) => boolean, keep: boolean): Promise<Reading> {
  const { uri } = await cam.takePictureAsync({ quality: keep ? 0.6 : 0.2, skipProcessing: true, shutterSound: false });
  let kept = false;
  try {
    const r = await analyzeFace(uri);
    kept = keep && ok(r);
    return kept ? { ...r, uri } : r;
  } finally {
    if (!kept) await drop(uri);
  }
}

/** #131: sample continuously until `ok` or the time is up (a fixed 3-frame window missed most moves). */
async function until(cam: Shot, ok: (r: FaceReading) => boolean, ms: number, keep = false): Promise<Reading | null> {
  const end = Date.now() + ms;
  do {
    const r = await frame(cam, ok, keep);
    if (ok(r)) return r;
  } while (Date.now() < end);
  return null;
}

const frontal = (r: FaceReading) => r.faces >= 1 && Math.abs(r.yaw ?? 0) < 0.35;

/** R-03.2 (#232): the two frontal stills vs own public photos (fresh URLs from /me), on this phone only. */
async function photoMatch(stills: string[]): Promise<SelfieOutcome> {
  const me = await api<Me>('GET', '/me');
  return selfieOutcome(await matchStills(stills, ownPhotoTargets(me.profile?.photos)));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// S-06 Verify (F-03): server nonce + 3 random steps → on-device liveness → blind-signed credential.
export function VerifyScreen({ onDone }: { onDone: (me: Me) => void }) {
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'intro' | 'camera' | 'failed' | 'unsupported'>('intro');
  const [why, setWhy] = useState<'liveness' | 'nomatch'>('liveness');
  const [prompt, setPrompt] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [perm, askPerm] = useCameraPermissions();
  const cam = useRef<Shot | null>(null);

  const finish = async (ch: Challenge, passed: boolean, reason: 'liveness' | 'nomatch' = 'liveness') => {
    setWhy(reason);
    const token = rand(32);
    const b = blind(token, ch.key, rand);
    const r = await api<{ signature?: string; passed?: boolean; attempts_left?: number }>('POST', '/verification/attest', { nonce: ch.nonce, passed, blinded: passed ? b.blinded : undefined });
    if (!r.signature) {
      setLeft(r.attempts_left ?? 0);
      setPhase('failed');
      return;
    }
    const { toB64url } = await import('../chat/bytes');
    onDone(await api<Me>('POST', '/verification/redeem', { token: toB64url(token), signature: b.unblind(r.signature) }));
  };

  const run = async () => {
    setErr(null);
    setBusy(true);
    const stills: string[] = [];
    try {
      if (!supported) {
        setPhase('unsupported');
        return;
      }
      const ch = await api<Challenge>('POST', '/verification/challenge');
      if (devSimulate) {
        await finish(ch, true);
        return;
      }
      if (!perm?.granted && !(await askPerm()).granted) {
        setErr(t.verify.camera);
        return;
      }
      setPhase('camera');
      await wait(1000);
      setPrompt(t.verify.steps.look);
      await wait(800);
      // Baseline: a face looking at the camera. None found → ask again, no try is spent (#131).
      const base = await until(cam.current!, frontal, 5000, selfieMatchAvailable);
      if (base?.uri) stills.push(base.uri);
      if (!base) {
        setPrompt('');
        setPhase('intro');
        setErr(t.verify.noFace);
        return;
      }
      let ok = true;
      for (const s of ch.steps) {
        setPrompt(t.verify.steps[s]);
        await wait(400);
        if (!(await until(cam.current!, (r) => passes(s, base, r), 6000))) {
          ok = false;
          break;
        }
        setPrompt('✓');
        await wait(500);
      }
      if (ok && selfieMatchAvailable) {
        // R-03.2 (#232): one more frontal still after the moves, then compare both with own photos.
        setPrompt(t.verify.steps.look);
        await wait(400);
        const end = await until(cam.current!, frontal, 4000, true);
        if (end?.uri) stills.push(end.uri);
        setPrompt(t.verify.matching);
        const out = end ? await photoMatch(stills) : 'noface';
        if (out === 'noface' || out === 'offline') {
          // Not the user's fault or not judgeable: the nonce is left to expire, no try is spent.
          setPrompt('');
          setPhase('intro');
          setErr(out === 'offline' ? t.verify.offline : t.verify.noFace);
          return;
        }
        setPrompt('');
        await finish(ch, out === 'pass', out === 'nomatch' ? 'nomatch' : 'liveness');
        return;
      }
      setPrompt('');
      await finish(ch, ok);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t.verify.error);
      setPhase('intro');
    } finally {
      // R-03.5: selfie stills are deleted after the check, whatever happened.
      await Promise.all(stills.map(drop));
      setBusy(false);
    }
  };

  const later = async () => {
    const me = await api<Me>('GET', '/me');
    onDone(me.onboarding_step === 'verify' ? await api<Me>('POST', '/me/onboarding/verify_later') : me);
  };

  if (phase === 'camera') {
    // S-06 liveness: front camera behind a face oval, one big prompt (R-02.8).
    return (
      <View style={{ flex: 1, backgroundColor: color.bgBase }}>
        <CameraView ref={(r) => void (cam.current = r as unknown as Shot)} facing="front" style={{ flex: 1 }} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={v.oval} />
        </View>
        <View style={v.promptBox}>
          <Text style={v.prompt} accessibilityLiveRegion="polite">{prompt}</Text>
          <Text style={v.private}>{t.verify.private}</Text>
        </View>
      </View>
    );
  }

  // S-06 intro (R-02.8): sell the payoff, then Verify now / Later.
  return (
    <StepShell
      step={STEP_OF.verify}
      title={o.verify.title}
      sub={o.verify.sub}
      scroll
      cta={{ title: phase === 'failed' ? t.verify.retry : o.verify.now, testID: 'verify-start', fill: color.trust, busy, disabled: phase === 'failed' && !left, onPress: run }}
      below={<BigButton testID="verify-later" kind="text" title={o.verify.later} onPress={later} />}
    >
      <View style={v.badge}>
        <Svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke={color.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M5 12l5 5 9-10" />
        </Svg>
      </View>
      <View style={{ gap: 10 }}>
        {o.verify.perks.map(([strong, rest]) => (
          <View key={strong} style={v.perk}>
            <View style={v.perkDot} />
            <Text style={v.perkText}>
              <Text style={{ fontFamily: font.heavy }}>{strong}</Text>
              {rest}
            </Text>
          </View>
        ))}
      </View>
      {phase === 'failed' ? <Banner text={!left ? t.verify.cooldown : why === 'nomatch' ? t.verify.noMatch(left) : t.verify.failed(left)} tone="warn" /> : null}
      {phase === 'unsupported' ? <Banner text={t.verify.iosOnly} tone="warn" /> : null}
      {err ? <Banner text={err} tone="danger" /> : null}
    </StepShell>
  );
}

const v = StyleSheet.create({
  oval: { width: 250, height: 320, borderRadius: 160, borderWidth: 6, borderColor: color.trust },
  promptBox: { position: 'absolute', left: 0, right: 0, bottom: 80, alignItems: 'center', padding: space.l, gap: space.s },
  prompt: { fontFamily: font.heavy, fontSize: 30, lineHeight: 34, letterSpacing: -0.9, color: color.fgPrimary, textAlign: 'center' },
  private: { ...type.meta, color: color.trust },
  badge: { width: 76, height: 76, borderRadius: 38, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center', marginTop: space.s },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: 14, borderRadius: radius.md, backgroundColor: color.bgRaised },
  perkDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.trust },
  perkText: { flex: 1, fontFamily: font.regular, fontSize: 15, lineHeight: 20, color: color.fgPrimary },
});

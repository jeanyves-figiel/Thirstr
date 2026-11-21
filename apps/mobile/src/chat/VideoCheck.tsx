// F-18 R-18.7–R-18.18 (#159, mockup option A): video check of a chat partner.
// S-45 request sheet · chat cards · S-46 recorder · S-47 hold-to-watch viewer · header badge.
import { gcm } from '@noble/ciphers/aes.js';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { api } from '../api/client';
import { useSession } from '../app/session';
import { moveText, vcx } from '../i18n/vcheck';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon, Sheet, Toggle } from '../ui';
import { native, SecureVideo } from '../../modules/thirstr-secure-video';
import { faceMatchAvailable, matchClip } from '../../modules/thirstr-face';
import type { ProfileView } from '../api/types';
import { photoTargets, verdict, type Verdict } from '../trust/faceMatch';
import { fromB64 } from './bytes';
import * as E from './engine';
import { readBytes, uploadEncrypted } from './media';
import * as V from './vcheck';

/** iOS app with the native module (web DEV and Android: not offered, R-18.13). */
export const vcAvailable = Platform.OS === 'ios' && !!SecureVideo;

const teal = color.trust;
const tealSoft = `${color.trust}1F`;

function MoveCard({ move, big }: { move: number; big?: boolean }) {
  return (
    <View testID="vc-move" style={[st.move, big && { padding: space.m, borderRadius: 16 }]}>
      <Text style={{ fontSize: big ? 26 : 18, letterSpacing: 2 }}>{V.moveEmoji(move)}</Text>
      <Text style={{ ...type.meta, fontFamily: font.bold, color: color.fgPrimary, flexShrink: 1 }}>{moveText(vcx, move)}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ S-45 request sheet

export function VcAskSheet({ conv, visible, onClose, onRecordMine }: { conv: E.Conv; visible: boolean; onClose: () => void; onRecordMine: (rid: string, move: number) => void }) {
  const [move, setMove] = useState(() => V.drawMove());
  const [mutual, setMutual] = useState(false);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      const rid = V.newRid();
      await E.sendVc(conv.id, { op: 'request', rid, move, mutual, exp: Date.now() + V.TTL_MS });
      onClose();
      if (mutual) onRecordMine(rid + 'm', move);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={vcx.title(conv.name)}>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{vcx.intro}</Text>
      <View style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={st.label}>{vcx.hisMove}</Text>
          <Pressable testID="vc-shuffle" accessibilityRole="button" onPress={() => setMove((m) => V.drawMove(m))} hitSlop={10}>
            <Text style={{ ...type.meta, fontFamily: font.bold, color: teal }}>⟳ {vcx.another}</Text>
          </Pressable>
        </View>
        <MoveCard move={move} big />
      </View>
      <Toggle label={vcx.mutual} sub={vcx.mutualSub} value={mutual} onChange={setMutual} tone={teal} />
      <Pressable testID="vc-ask" accessibilityRole="button" disabled={busy} onPress={ask} style={({ pressed }) => [st.cta, { opacity: busy ? 0.5 : pressed ? 0.85 : 1 }]}>
        <Text style={{ ...type.headline, color: color.onAccent }}>{vcx.ask}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Icon.Lock size={14} c={teal} />
        <Text style={{ ...type.caption, fontFamily: font.medium, color: teal, flex: 1 }}>{vcx.e2e}</Text>
      </View>
    </Sheet>
  );
}

// ------------------------------------------------------------------ chat rows

function Btn({ title, onPress, ghost, testID }: { title: string; onPress: () => void; ghost?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.btn, ghost ? st.btnGhost : { backgroundColor: teal }, { opacity: pressed ? 0.85 : 1 }]}>
      <Text style={{ ...type.meta, fontFamily: font.heavy, color: ghost ? color.fgSecondary : color.onAccent }}>{title}</Text>
    </Pressable>
  );
}

function SysLine({ text, testID }: { text: string; testID?: string }) {
  return (
    <View testID={testID} style={st.sys}>
      <Icon.VideoCheck size={14} c={teal} />
      <Text style={{ ...type.meta, fontFamily: font.heavy, color: teal, flexShrink: 1, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** One `vcheck` row of the chat. The card shows the live state of its check, not the message. */
export function VcRow({ m, conv, onRecord, onWatch }: { m: E.Msg; conv: E.Conv; onRecord: (v: V.Vc) => void; onWatch: (v: V.Vc) => void }) {
  V.useVc();
  const p = m.p as V.VcPayload;
  const v = V.get(p.rid);
  const s = V.effective(v);
  const mine = m.from === 'me';
  if (p.op === 'confirm') return <SysLine testID="vc-confirmed" text={`${mine ? vcx.youChecked(conv.name) : vcx.checkedYou(conv.name)} · ${day(m.at)}`} />;
  if (p.op === 'screenshot') return <SysLine testID="vc-shot" text={`📸 ${vcx.shot(conv.name)}`} />;
  if (!v) return null;

  if (p.op === 'request') {
    if (mine) {
      const line = s === 'declined' ? vcx.declined(conv.name) : s === 'cancelled' ? vcx.cancelled : s === 'expired' ? vcx.expired : s === 'requested' ? vcx.waiting(conv.name) : vcx.watched;
      return (
        <View testID="vc-asked" style={[st.card, st.right]}>
          <View style={st.cardHead}>
            <View style={st.ico}><Icon.VideoCheck size={15} c={color.onAccent} /></View>
            <Text style={st.cardTitle}>{vcx.youAsked}</Text>
          </View>
          <MoveCard move={v.move} />
          <Text style={st.cardLine}>{line}</Text>
          {s === 'requested' ? <Btn ghost title={vcx.cancel} onPress={() => E.sendVc(conv.id, { op: 'cancel', rid: v.rid })} testID="vc-cancel" /> : null}
        </View>
      );
    }
    const live = s === 'requested';
    return (
      <View testID="vc-request" style={[st.card, st.left]}>
        <View style={st.cardHead}>
          <View style={st.ico}><Icon.VideoCheck size={15} c={color.onAccent} /></View>
          <Text style={st.cardTitle}>{vcx.asksYou(conv.name)}</Text>
        </View>
        <MoveCard move={v.move} />
        {live ? (
          <>
            <Text style={st.cardLine}>{vcx.cardLine}</Text>
            <Text style={[st.cardLine, { color: color.warn }]}>⚠ {vcx.filmWarn}</Text>
            {vcAvailable ? (
              <View style={{ flexDirection: 'row', gap: space.s }}>
                <Btn title={vcx.record} onPress={() => onRecord(v)} testID="vc-record" />
                <Btn ghost title={vcx.notNow} onPress={() => E.sendVc(conv.id, { op: 'decline', rid: v.rid })} testID="vc-decline" />
              </View>
            ) : (
              <>
                <Text style={st.cardLine}>{vcx.phoneOnly}</Text>
                <Btn ghost title={vcx.notNow} onPress={() => E.sendVc(conv.id, { op: 'decline', rid: v.rid })} testID="vc-decline" />
              </>
            )}
          </>
        ) : (
          <Text style={st.cardLine}>{s === 'declined' ? vcx.youDeclined : s === 'cancelled' ? vcx.cancelled : s === 'expired' ? vcx.expired : vcx.watched}</Text>
        )}
      </View>
    );
  }

  // op === 'clip'
  if (v.dir === 'in') {
    return (
      <View testID="vc-sent" style={[st.card, st.right]}>
        <View style={st.cardHead}>
          <View style={st.ico}><Icon.Check size={15} c={color.onAccent} /></View>
          <Text style={st.cardTitle}>{vcx.youSent}</Text>
        </View>
        <Text style={st.cardLine}>{s === 'recorded' ? vcx.sentWaiting(conv.name) : s === 'expired' ? vcx.expired : vcx.watchedDeleted}</Text>
      </View>
    );
  }
  const ready = s === 'recorded' && !!v.clip;
  return (
    <View testID="vc-ready" style={[st.card, st.left]}>
      <View style={st.cardHead}>
        <View style={st.ico}><Icon.VideoCheck size={15} c={color.onAccent} /></View>
        <Text style={st.cardTitle}>{vcx.ready(conv.name)}</Text>
      </View>
      {ready ? (
        vcAvailable ? (
          <>
            <Text style={st.cardLine}>{vcx.readyLine}</Text>
            <Btn title={`◉ ${vcx.watch}`} onPress={() => onWatch(v)} testID="vc-watch" />
          </>
        ) : (
          <Text style={st.cardLine}>{vcx.phoneOnly}</Text>
        )
      ) : (
        <Text style={st.cardLine}>{s === 'expired' ? vcx.expired : vcx.watchedDeleted}</Text>
      )}
    </View>
  );
}

/** R-18.17: teal pill under the name in the chat header. */
export function VcBadge({ peer }: { peer: string }) {
  V.useVc();
  const b = V.badgeOf(peer);
  if (!b) return null;
  const months = b.months;
  return (
    <View testID="vc-badge" style={[st.badge, !b.fresh && { backgroundColor: color.bgOverlay }]}>
      <Icon.VideoCheck size={11} c={b.fresh ? color.onAccent : color.fgSecondary} w={2.6} />
      <Text style={{ ...type.caption, fontSize: 10, color: b.fresh ? color.onAccent : color.fgSecondary }}>{b.fresh ? vcx.badge : vcx.badgeOld(months)}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ S-46 recorder

type Rec = { rid: string; move: number; offer?: boolean };

export function VcRecorder({ conv, rec, onClose }: { conv: E.Conv; rec: Rec | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [perm, ask] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [phase, setPhase] = useState<'idle' | 'count' | 'rec' | 'done' | 'sending'>('idle');
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [takes, setTakes] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(0);
  const discard = useRef(false);

  const dropFile = async (u: string | null) => {
    if (!u) return;
    try {
      const { File } = await import('expo-file-system');
      const f = new File(u);
      if (f.exists) f.delete();
    } catch {}
  };
  const reset = () => {
    setPhase('idle');
    setSecs(0);
    setErr(null);
  };
  const record = async () => {
    if (!ref.current) return;
    discard.current = false;
    started.current = Date.now();
    setPhase('rec');
    try {
      const out = await ref.current.recordAsync({ maxDuration: V.MAX_S, codec: 'avc1' });
      if (!out?.uri || discard.current) {
        await dropFile(out?.uri ?? null);
        reset();
        return;
      }
      const clean = native ? await native.stripMetadata(out.uri) : out.uri;
      setUri(clean);
      setTakes((n) => n + 1);
      setPhase('done');
    } catch {
      reset();
    }
  };
  // R-18.10: leaving the app while recording discards the clip.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' && phase === 'rec') {
        discard.current = true;
        ref.current?.stopRecording();
      }
    });
    return () => sub.remove();
  }, [phase]);
  useEffect(() => {
    if (phase !== 'count') return;
    // 3-2-1, then record (R-18.10).
    const t = setTimeout(() => {
      if (count <= 1) record();
      else setCount(count - 1);
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, count]);
  useEffect(() => {
    if (phase !== 'rec') return;
    const t = setInterval(() => setSecs(Math.min(V.MAX_S, (Date.now() - started.current) / 1000)), 100);
    return () => clearInterval(t);
  }, [phase]);

  const shutter = () => {
    if (phase === 'idle') {
      setCount(3);
      setPhase('count');
    } else if (phase === 'rec' && (Date.now() - started.current) / 1000 >= V.MIN_S) {
      ref.current?.stopRecording();
    }
  };
  const close = () => {
    if (phase === 'rec') {
      discard.current = true;
      ref.current?.stopRecording();
    }
    dropFile(uri);
    setUri(null);
    onClose();
  };
  const retake = () => {
    dropFile(uri);
    setUri(null);
    reset();
  };
  const send = async () => {
    if (!uri || !rec) return;
    setPhase('sending');
    try {
      const bytes = await readBytes(uri);
      if (bytes.length > V.MAX_BYTES) {
        setErr(vcx.tooBig);
        setPhase('done');
        return;
      }
      const blob = await uploadEncrypted(bytes, { once: true });
      bytes.fill(0);
      await E.sendVc(conv.id, { op: 'clip', rid: rec.rid, move: rec.move, offer: rec.offer || undefined, clip: { ...blob, dur: Math.round(secs * 1000) } });
      await dropFile(uri);
      setUri(null);
      onClose();
    } catch {
      setErr(vcx.loadFailed);
      setPhase('done');
    }
  };

  const ringP = phase === 'rec' ? secs / V.MAX_S : 0;
  const C = 2 * Math.PI * 34;
  return (
    <Modal visible={!!rec} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: color.shadow }}>
        {rec && perm?.granted && phase !== 'done' && phase !== 'sending' ? (
          <CameraView ref={ref} style={StyleSheet.absoluteFill} facing="front" mode="video" mute videoQuality="720p" videoBitrate={2_000_000} />
        ) : null}
        {rec && uri && SecureVideo && (phase === 'done' || phase === 'sending') ? <SecureVideo style={StyleSheet.absoluteFill} uri={uri} playing loop /> : null}
        {phase !== 'done' && phase !== 'sending' ? <View pointerEvents="none" style={st.oval} /> : null}

        <View style={{ paddingTop: insets.top + space.s, paddingHorizontal: space.l, gap: space.s }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={vcx.close} onPress={close} style={st.round}>
              <Icon.Close c={color.fgPrimary} />
            </Pressable>
          </View>
          {rec ? (
            <View style={st.ask}>
              <Text style={{ fontSize: 26, letterSpacing: 2 }}>{V.moveEmoji(rec.move)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{moveText(vcx, rec.move)}</Text>
                <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgSecondary }}>{vcx.willCheck(conv.name)}</Text>
              </View>
            </View>
          ) : null}
          {phase === 'rec' ? (
            <View style={st.rec}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.fgPrimary }} />
              <Text style={{ ...type.caption, color: color.fgPrimary }}>REC 0:0{Math.floor(secs)}</Text>
            </View>
          ) : null}
        </View>

        {phase === 'count' ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontFamily: font.heavy, fontSize: 96, color: color.fgPrimary }}>{count || ''}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 'auto', paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.l, alignItems: 'center', gap: space.m }}>
          {!perm?.granted ? (
            <>
              <Text style={{ ...type.body, color: color.fgPrimary, textAlign: 'center' }}>{vcx.camAccess}</Text>
              <Pressable accessibilityRole="button" onPress={ask} style={st.cta}>
                <Text style={{ ...type.headline, color: color.onAccent }}>{vcx.allow}</Text>
              </Pressable>
            </>
          ) : phase === 'done' || phase === 'sending' ? (
            <>
              {err ? <Text style={{ ...type.meta, color: color.warn, textAlign: 'center' }}>{err}</Text> : null}
              <View style={{ flexDirection: 'row', gap: space.m, alignSelf: 'stretch' }}>
                {takes < 3 ? (
                  <Pressable testID="vc-retake" accessibilityRole="button" disabled={phase === 'sending'} onPress={retake} style={[st.cta, st.ctaGhost, { flex: 1 }]}>
                    <Text style={{ ...type.headline, color: color.fgPrimary }}>{vcx.retake}</Text>
                  </Pressable>
                ) : null}
                <Pressable testID="vc-send" accessibilityRole="button" disabled={phase === 'sending'} onPress={send} style={[st.cta, { flex: 1, opacity: phase === 'sending' ? 0.6 : 1 }]}>
                  <Text style={{ ...type.headline, color: color.onAccent }}>{phase === 'sending' ? vcx.sending : vcx.send}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Pressable testID="vc-shutter" accessibilityRole="button" accessibilityLabel={vcx.record} onPress={shutter} style={st.shutter}>
                <Svg width={76} height={76} viewBox="0 0 76 76" style={StyleSheet.absoluteFill}>
                  <Circle cx={38} cy={38} r={34} stroke={color.fgPrimary} strokeWidth={4} fill="none" opacity={0.9} />
                  {phase === 'rec' ? <Circle cx={38} cy={38} r={34} stroke={color.danger} strokeWidth={4} fill="none" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - ringP)} transform="rotate(-90 38 38)" strokeLinecap="round" /> : null}
                </Svg>
                <View style={{ width: phase === 'rec' ? 26 : 56, height: phase === 'rec' ? 26 : 56, borderRadius: phase === 'rec' ? 7 : 28, backgroundColor: color.danger }} />
              </Pressable>
              <Text style={{ ...type.meta, color: color.fgPrimary, textAlign: 'center' }}>{vcx.tapStart}</Text>
              <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgSecondary, textAlign: 'center' }}>{vcx.recFoot}</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------ S-47 viewer (hold to watch)

export function VcViewer({ conv, v, onClose, onReport }: { conv: E.Conv; v: V.Vc | null; onClose: () => void; onReport: () => void }) {
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'end' | 'failed'>('loading');
  const [uri, setUri] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [prog, setProg] = useState(0);
  const [answered, setAnswered] = useState<null | boolean>(null);
  // R-18.15 (#185): on-device face match, runs while he watches; 'pending' until done, null = show nothing.
  const [face, setFace] = useState<Verdict | 'pending'>(null);
  const matching = useRef<Promise<unknown> | null>(null);
  const file = useRef<string | null>(null);
  const viewer = me?.profiles?.find((x) => x.id === conv.me)?.display_name ?? '';
  const [stamp] = useState(() => new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));

  const wipe = async () => {
    const u = file.current;
    file.current = null;
    setUri(null);
    if (!u) return;
    // The match reads frames from the clip file: let it finish (max 4 s) before the file goes.
    const m = matching.current;
    if (m) await Promise.race([m.catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
    try {
      const { File } = await import('expo-file-system');
      const f = new File(u);
      if (f.exists) f.delete();
    } catch {}
  };

  const end = () => {
    setHeld(false);
    setPhase('end');
    wipe();
  };

  // Download once, decrypt on the phone, delete the server copy at once (R-18.12, R-18.14).
  useEffect(() => {
    if (!v?.clip) return;
    let alive = true;
    (async () => {
      try {
        const clip = v.clip!;
        const { url } = await api<{ url: string }>('GET', `/media/${clip.blob}`);
        const ct = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const plain = gcm(fromB64(clip.key), fromB64(clip.iv)).decrypt(ct);
        const { File, Paths } = await import('expo-file-system');
        const f = new File(Paths.cache, `vc-${V.newRid()}.mp4`);
        f.create();
        f.write(plain);
        plain.fill(0);
        api('DELETE', `/media/${clip.blob}`).catch(() => {});
        await V.mark(v.rid, 'watched');
        if (!alive) {
          f.delete();
          return;
        }
        file.current = f.uri;
        setUri(f.uri);
        setPhase('ready');
        if (faceMatchAvailable) {
          setFace('pending');
          const run = api<ProfileView>('GET', `/profiles/${conv.peer}`)
            .then((p) => matchClip(f.uri, photoTargets(p.photos)))
            .then((r) => verdict(r), () => null);
          matching.current = run;
          run.then((r) => alive && setFace(r));
        }
      } catch {
        if (alive) setPhase('failed');
      }
    })();
    return () => {
      alive = false;
      wipe();
    };
  }, [v?.rid]);

  // R-18.13: capture state + screenshot notice to the recorder.
  useEffect(() => {
    if (!v || !native) return;
    native.isCaptured().then(setCaptured, () => {});
    const a = native.addListener('onCapture', (e) => setCaptured(!!e.captured));
    const b = native.addListener('onScreenshot', () => E.sendVc(conv.id, { op: 'screenshot', rid: v.rid }).catch(() => {}));
    return () => {
      a.remove();
      b.remove();
    };
  }, [v?.rid]);

  // Leaving the app or locking the phone ends viewing (counts as watched).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && phase === 'ready') end();
    });
    return () => sub.remove();
  }, [phase]);

  const answer = (ok: boolean) => {
    if (!v) return;
    setAnswered(ok);
    if (ok) E.sendVc(conv.id, { op: 'confirm', rid: v.rid }).catch(() => {});
    else V.mark(v.rid, 'rejected').then(() => E.sendVc(conv.id, { op: 'done', rid: v.rid })).catch(() => {});
  };
  const close = () => {
    if (v && answered === null) E.sendVc(conv.id, { op: 'done', rid: v.rid }).catch(() => {});
    wipe();
    onClose();
  };

  const showing = phase === 'ready' && held && !captured;
  return (
    <Modal visible={!!v} animationType="fade" onRequestClose={close} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: color.shadow }}>
        <Pressable
          testID="vc-hold"
          accessibilityRole="button"
          accessibilityLabel={vcx.hold}
          disabled={phase !== 'ready'}
          onPressIn={() => setHeld(true)}
          onPressOut={() => setHeld(false)}
          style={StyleSheet.absoluteFill}
        >
          {SecureVideo && uri ? (
            <SecureVideo
              style={[StyleSheet.absoluteFill, { opacity: showing ? 1 : 0 }]}
              uri={uri}
              playing={showing}
              onProgress={(e) => e.nativeEvent.d > 0 && setProg(Math.min(1, e.nativeEvent.t / e.nativeEvent.d))}
              onEnd={end}
              onError={() => setPhase('failed')}
            />
          ) : null}
          {showing ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
              <View style={{ transform: [{ rotate: '-28deg' }], gap: 44 }}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Text key={i} style={{ fontFamily: font.heavy, fontSize: 15, color: color.fgPrimary, opacity: 0.18, textAlign: 'center' }}>
                    {viewer} · {stamp}   {viewer} · {stamp}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </Pressable>

        <View pointerEvents="box-none" style={{ paddingTop: insets.top + space.s, paddingHorizontal: space.l, gap: space.s }}>
          <View style={st.bar}>
            <View style={{ width: `${prog * 100}%`, height: '100%', backgroundColor: color.fgPrimary }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            {v ? (
              <View style={[st.ask, { flex: 1 }]}>
                <Text style={{ fontSize: 22, letterSpacing: 2 }}>{V.moveEmoji(v.move)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgPrimary }}>{vcx.youAskedMove(moveText(vcx, v.move))}</Text>
                  <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgSecondary }}>{vcx.recordedAt(conv.name, new Date(v.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</Text>
                </View>
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel={vcx.close} onPress={close} style={st.round}>
              <Icon.Close c={color.fgPrimary} />
            </Pressable>
          </View>
        </View>

        {phase === 'ready' && !held && !captured ? (
          <View pointerEvents="none" style={{ marginTop: 'auto', paddingBottom: insets.bottom + space.xxl, alignItems: 'center', gap: space.s, paddingHorizontal: space.l }}>
            <View style={st.hint}>
              <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{prog > 0 ? vcx.holdMore : vcx.hold}</Text>
            </View>
            <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgSecondary, textAlign: 'center' }}>{vcx.holdFoot}</Text>
          </View>
        ) : null}
        {phase === 'loading' ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ ...type.meta, color: color.fgSecondary }}>…</Text>
          </View>
        ) : null}
        {captured && phase !== 'end' ? (
          <View testID="vc-captured" style={[StyleSheet.absoluteFill, st.black]}>
            <Text style={{ ...type.headline, color: color.fgPrimary, textAlign: 'center' }}>{vcx.captured}</Text>
            <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>{vcx.capturedSub}</Text>
          </View>
        ) : null}
        {phase === 'failed' ? (
          <View style={[StyleSheet.absoluteFill, st.black]}>
            <Text style={{ ...type.body, color: color.fgPrimary, textAlign: 'center' }}>{vcx.gone}</Text>
            <Pressable accessibilityRole="button" onPress={close} style={[st.cta, st.ctaGhost, { alignSelf: 'stretch' }]}>
              <Text style={{ ...type.headline, color: color.fgPrimary }}>{vcx.close}</Text>
            </Pressable>
          </View>
        ) : null}
        {phase === 'end' ? (
          <View testID="vc-end" style={[StyleSheet.absoluteFill, { backgroundColor: color.bgBase, justifyContent: 'center', padding: space.xl, gap: space.l }]}>
            {answered === null ? (
              <>
                <FaceLine v={face} />
                <Text style={{ ...type.title, color: color.fgPrimary, textAlign: 'center' }}>{vcx.didHe}</Text>
                {v ? <MoveCard move={v.move} big /> : null}
                <View style={{ flexDirection: 'row', gap: space.m }}>
                  <Pressable testID="vc-yes" accessibilityRole="button" onPress={() => answer(true)} style={[st.cta, { flex: 1 }]}>
                    <Text style={{ ...type.headline, color: color.onAccent }}>{vcx.yes}</Text>
                  </Pressable>
                  <Pressable testID="vc-no" accessibilityRole="button" onPress={() => answer(false)} style={[st.cta, st.ctaGhost, { flex: 1 }]}>
                    <Text style={{ ...type.headline, color: color.fgPrimary }}>{vcx.no}</Text>
                  </Pressable>
                </View>
              </>
            ) : answered ? (
              <>
                <View style={[st.ico, { width: 56, height: 56, borderRadius: 28, alignSelf: 'center' }]}><Icon.Check size={28} c={color.onAccent} /></View>
                <Text style={{ ...type.title, color: color.fgPrimary, textAlign: 'center' }}>{vcx.youChecked(conv.name)}</Text>
                <Pressable accessibilityRole="button" onPress={close} style={st.cta}>
                  <Text style={{ ...type.headline, color: color.onAccent }}>{vcx.close}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ ...type.headline, color: color.fgPrimary, textAlign: 'center' }}>{vcx.reportHint}</Text>
                <View style={{ flexDirection: 'row', gap: space.m }}>
                  <Pressable accessibilityRole="button" onPress={() => { close(); onReport(); }} style={[st.cta, { flex: 1, backgroundColor: color.danger }]}>
                    <Text style={{ ...type.headline, color: color.onAccent }}>{vcx.report}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={close} style={[st.cta, st.ctaGhost, { flex: 1 }]}>
                    <Text style={{ ...type.headline, color: color.fgPrimary }}>{vcx.close}</Text>
                  </Pressable>
                </View>
              </>
            )}
            <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgMuted, textAlign: 'center' }}>{vcx.goneNow}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** R-18.15: result of the on-device face match, shown above "Did he do the move?". Nothing when no verdict. */
function FaceLine({ v }: { v: Verdict | 'pending' }) {
  if (!v) return null;
  const ok = v === 'match';
  const c = v === 'pending' ? color.fgMuted : ok ? color.trust : color.warn;
  return (
    <View testID={`vc-face-${v}`} style={{ alignItems: 'center', gap: 6 }}>
      <View style={[st.face, { borderColor: `${c}59`, backgroundColor: `${c}1F` }]}>
        {v === 'pending' ? null : ok ? <Icon.Check size={14} c={c} /> : <Text style={{ ...type.meta, fontFamily: font.heavy, color: c }}>?</Text>}
        <Text style={{ ...type.meta, fontFamily: font.bold, color: c }}>{v === 'pending' ? vcx.faceChecking : ok ? vcx.faceMatch : vcx.faceNoMatch}</Text>
      </View>
      {v === 'pending' ? null : <Text style={{ ...type.caption, fontFamily: font.medium, color: color.fgMuted, textAlign: 'center' }}>{ok ? vcx.faceMatchSub : vcx.faceNoMatchSub}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  face: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  label: { ...type.caption, letterSpacing: 0.8, textTransform: 'uppercase', color: color.fgMuted },
  move: { flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: color.bgBase, borderRadius: radius.sm, paddingHorizontal: space.m, paddingVertical: 8 },
  cta: { height: 50, borderRadius: radius.pill, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  ctaGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.line },
  card: { width: '86%', maxWidth: 340, padding: space.m, gap: space.s, borderRadius: radius.md, borderWidth: 1.5, borderColor: `${color.trust}73`, backgroundColor: color.bgRaised, marginVertical: space.xs },
  left: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  right: { alignSelf: 'flex-end', borderBottomRightRadius: 6, backgroundColor: color.bgOverlay },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  cardTitle: { ...type.headline, fontSize: 14, color: color.fgPrimary, flexShrink: 1 },
  cardLine: { ...type.meta, fontSize: 12, lineHeight: 16, color: color.fgSecondary },
  ico: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' },
  btn: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m },
  btnGhost: { borderWidth: 1.5, borderColor: color.line },
  sys: { alignSelf: 'center', maxWidth: '90%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: tealSoft, marginVertical: space.s },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color.trust, marginTop: 1 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(23,20,46,0.7)', alignItems: 'center', justifyContent: 'center' },
  ask: { flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: 'rgba(23,20,46,0.84)', borderRadius: 16, paddingHorizontal: space.m, paddingVertical: 10 },
  rec: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.danger, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  oval: { position: 'absolute', left: '50%', top: '42%', width: 230, height: 290, marginLeft: -115, marginTop: -145, borderRadius: 145, borderWidth: 3, borderStyle: 'dashed', borderColor: `${color.trust}B3` },
  shutter: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  hint: { backgroundColor: 'rgba(23,20,46,0.85)', paddingHorizontal: space.l, paddingVertical: 10, borderRadius: radius.pill },
  black: { backgroundColor: color.shadow, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.m },
});

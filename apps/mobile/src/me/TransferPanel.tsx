// F-01 R-01.14 (#146) old phone, right after the link: "Bring your chats?" (mockup board 1), then
// "Moving your chats" (board 2). The new phone shows its side in Chats (TransferCard).
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { unmetered } from '../app/dataSaver';
import * as X from '../chat/transfer';
import { mb } from '../i18n/backup';
import { xx } from '../i18n/transfer';
import { color, radius, space, type } from '../theme/tokens';
import { Switch } from './settings/parts';

type Props = { linkCode: string; keys: X.Keys; peerPub: string; code: string; device: string; onClose: () => void };

export function TransferPanel({ linkCode, keys, peerPub, code, device, onClose }: Props) {
  const [range, setRange] = useState<X.Range>('all');
  const [withMedia, setWithMedia] = useState(unmetered); // R-01.14: off on mobile data
  const [plans, setPlans] = useState<Partial<Record<X.Range, Awaited<ReturnType<typeof X.plan>>>>>({});
  const [prog, setProg] = useState<X.Progress | null>(null);
  const ctl = useRef<ReturnType<typeof X.send> | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const all = await X.plan('all');
      if (live) setPlans((p) => ({ ...p, all }));
      const year = await X.plan('year');
      if (live) setPlans((p) => ({ ...p, year }));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => void ctl.current?.cancel(), []);

  const est = (r: X.Range) => (plans[r] ? X.estimate(plans[r]!) : null);
  const cur = est(range);
  const size = (e: X.Estimate | null) => (e ? mb(e.textBytes + (withMedia ? e.mediaBytes : 0)) : '…');

  const start = () => {
    const p = plans[range];
    if (!p) return;
    setProg({ sent: 0, acked: 0, bytes: 0, state: 'sending' });
    ctl.current = X.send({ linkCode, keys, peerPub, plan: p, withMedia, onProgress: setProg });
    ctl.current.done.catch(() => setProg((x) => ({ ...(x ?? { sent: 0, acked: 0, bytes: 0 }), state: 'failed' })));
  };

  if (prog) {
    const totalBytes = cur ? cur.textBytes + (withMedia ? cur.mediaBytes : 0) : 0;
    const pct = prog.state === 'done' ? 100 : totalBytes ? Math.min(99, Math.round((prog.bytes / totalBytes) * 100)) : 0;
    return (
      <View testID="xfer-progress" style={{ gap: space.l, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
        <Text style={{ ...type.title, color: color.fgPrimary }}>{prog.state === 'done' ? xx.done : xx.moving}</Text>
        {prog.state === 'failed' ? <Text style={{ ...type.body, color: color.fgSecondary }}>{xx.failed}</Text> : <Text style={{ ...type.meta, color: color.fgSecondary }}>{xx.movingSub}</Text>}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>{xx.percent(pct)}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>{xx.ofSize(mb(prog.bytes), mb(totalBytes))}</Text>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 8, borderRadius: 4, backgroundColor: color.bgBase, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: color.trust }} />
        </View>
        <Text style={{ ...type.meta, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>{xx.pieces(prog.acked, prog.total ?? '…')}</Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{xx.sealed}</Text>
        {prog.state === 'done' || prog.state === 'cancelled' ? (
          <Btn title="OK" onPress={onClose} fill />
        ) : prog.state === 'failed' ? (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Btn title={xx.again} onPress={start} fill />
            <Btn title={xx.cancel} onPress={onClose} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Btn title={prog.state === 'paused' ? xx.resume : xx.pause} onPress={() => ctl.current?.pause(prog.state !== 'paused')} />
            <Btn title={xx.cancel} onPress={() => ctl.current?.cancel().then(onClose)} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View testID="xfer-offer" style={{ gap: space.m, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
      <Text style={{ ...type.title, color: color.fgPrimary }}>{xx.offerTitle}</Text>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{xx.offerSub(device)}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
        {(['all', 'year'] as X.Range[]).map((r) => {
          const on = range === r;
          const e = est(r);
          return (
            <Pressable key={r} testID={`xfer-${r}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setRange(r)} style={{ minHeight: 56, borderRadius: radius.md, backgroundColor: color.bgOverlay, borderWidth: 2, borderColor: on ? color.trust : 'transparent', padding: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? color.trust : color.fgMuted, alignItems: 'center', justifyContent: 'center' }}>{on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.trust }} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.headline, color: color.fgPrimary }}>{r === 'all' ? xx.all : xx.year}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{e ? xx.counts(e.chats, e.messages) : xx.counting}</Text>
              </View>
              <Text style={{ ...type.meta, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>{size(e)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.body, color: color.fgPrimary }}>{xx.media}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{xx.textOnly(cur ? mb(cur.textBytes) : '…')}</Text>
        </View>
        <Switch label={xx.media} value={withMedia} onChange={setWithMedia} />
      </View>
      <View style={{ backgroundColor: color.bgBase, borderRadius: radius.md, padding: space.m, gap: 2 }}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{xx.check('')}</Text>
        <Text testID="xfer-code" style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, color: color.trust, fontVariant: ['tabular-nums'] }}>
          {code}
        </Text>
      </View>
      {cur ? <Btn testID="xfer-start" title={xx.start} onPress={start} fill /> : <ActivityIndicator color={color.trust} />}
      <Btn title={xx.notNow} onPress={onClose} />
      <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>{xx.stays}</Text>
    </View>
  );
}

function Btn({ title, onPress, fill, testID }: { title: string; onPress: () => void; fill?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: fill ? color.trust : color.bgOverlay, opacity: pressed ? 0.85 : 1 })}>
      <Text style={{ ...type.headline, color: fill ? color.onAccent : color.fgPrimary }}>{title}</Text>
    </Pressable>
  );
}

/** New phone, top of Chats (mockup board 3): receives while the old phone sends. */
export function TransferCard() {
  const [on] = useState(X.expecting);
  const [r, setR] = useState<{ chats: number; messages: number; media: number; acked: number; total?: number; pct: number } | null>(null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    X.receive(
      (p) => live && setR({ chats: p.chats, messages: p.messages, media: p.media, acked: p.chunks, total: p.total, pct: p.estimate ? Math.min(99, Math.round((p.bytes / p.estimate) * 100)) : 0 }),
      () => live,
    )
      .then((t) => live && t && t.chunks > 0 && setDone(true))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [on]);

  if (!on || hidden || !r) return null;
  return (
    <View testID="xfer-card" style={{ marginHorizontal: space.l, marginBottom: space.m, padding: space.l, gap: space.s, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
      <Text style={{ ...type.headline, color: color.fgPrimary }}>{done ? xx.arrived : xx.arriving}</Text>
      <Text style={{ ...type.meta, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>{xx.arrivedSub(r.chats, r.messages, r.media)}</Text>
      {done ? (
        <Pressable accessibilityRole="button" onPress={() => setHidden(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ ...type.headline, color: color.trust }}>OK</Text>
        </Pressable>
      ) : (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: r.pct }} style={{ height: 4, borderRadius: 2, backgroundColor: color.bgBase, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${Math.max(5, r.pct)}%`, backgroundColor: color.trust }} />
        </View>
      )}
    </View>
  );
}

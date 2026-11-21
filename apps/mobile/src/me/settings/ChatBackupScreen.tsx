// Settings › Chats & media › Chat backup (F-01 R-01.15, #146, mockup board 4) and the restore card
// in Chats (board 5: started from "You're back" or shown when this phone has no chats yet).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { vaultKey } from '../../auth/recovery';
import * as B from '../../chat/backup';
import * as E from '../../chat/engine';
import { tx } from '../../i18n/app';
import { bx, mb } from '../../i18n/backup';
import { color, radius, space, type } from '../../theme/tokens';
import { Group, Page, Row, SwitchRow } from './parts';

type Nav = { navigate: (s: string, p?: object) => void };

const when = (iso: string | number) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Summary for the Chats & media row. */
export function useBackupSummary() {
  const [s, setS] = useState<string | undefined>();
  useEffect(() => {
    B.prefs().then(async (p) => {
      if (!p.on) return setS(bx.sumOff);
      const at = await B.lastRun();
      setS(at ? bx.sumOn(when(at)) : bx.never);
    });
  }, []);
  return s;
}

const fetchAll = () => Promise.all([api<{ on: boolean }>('GET', '/me/recovery').catch(() => ({ on: false })), B.prefs(), B.info()]);

export function ChatBackupSettings({ navigation }: { navigation: Nav }) {
  const [phrase, setPhrase] = useState<boolean | null>(null);
  const [p, setP] = useState<B.Prefs | null>(null);
  const [info, setInfo] = useState<B.Info>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = useCallback(([r, pr, i]: [{ on: boolean }, B.Prefs, B.Info]) => {
    setPhrase(r.on);
    setP(pr);
    setInfo(i);
  }, []);
  const load = useCallback(() => fetchAll().then(apply), [apply]);
  useEffect(() => {
    fetchAll().then(apply);
  }, [apply]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch {
      setErr(bx.failed);
    }
    await load();
    setBusy(false);
  };

  if (phrase === null || !p) return <Page title={bx.title} loading />;
  if (!phrase)
    return (
      <Page title={bx.title}>
        <Group hint={bx.needPhraseSub}>
          <Row testID="backup-need-phrase" title={bx.needPhrase} value={bx.setUp} onPress={() => navigation.navigate('Recovery', { offer: false })} />
        </Group>
      </Page>
    );

  const on = p.on;
  return (
    <Page title={bx.title} err={err}>
      <Group hint={bx.lock}>
        <SwitchRow
          testID="backup-on"
          title={bx.on}
          sub={on ? (info ? bx.last(when(info.updated_at), mb(info.bytes)) : bx.never) : undefined}
          value={on}
          disabled={busy}
          onChange={(v) => run(() => (v ? B.turnOn(p.cellular) : B.turnOff()))}
        />
        {on ? (
          <Pressable testID="backup-now" accessibilityRole="button" disabled={busy} onPress={() => run(() => B.backupNow())} style={({ pressed }) => ({ minHeight: 52, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.s, backgroundColor: pressed ? color.bgOverlay : 'transparent' })}>
            {busy ? <ActivityIndicator color={color.trust} /> : null}
            <Text style={{ ...type.headline, color: color.trust }}>{busy ? bx.running : bx.now}</Text>
          </Pressable>
        ) : null}
      </Group>
      {on ? (
        <Group hint={bx.rules}>
          <SwitchRow testID="backup-cellular" title={bx.cellular} sub={p.cellular ? bx.cellularOn : bx.cellularOff} value={p.cellular} onChange={(v) => B.setCellular(v).then(load)} />
        </Group>
      ) : (
        <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{bx.rules}</Text>
      )}
    </Page>
  );
}

/**
 * Card at the top of Chats: runs a requested restore, or offers one when a backup exists, this
 * phone holds the key and has no chats yet.
 */
export function RestoreCard() {
  const [info, setInfo] = useState<B.Info>(null);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  const [n, setN] = useState(0);
  const [hidden, setHidden] = useState(true);

  const start = useCallback(async () => {
    setState('running');
    try {
      const r = await B.restore({ onProgress: (d, t) => setProg([d, t]) });
      await B.clearRestorePending();
      setN(r.messages);
      setState('done');
    } catch {
      setState('failed');
    }
  }, []);

  useEffect(() => {
    (async () => {
      const i = await B.info();
      if (!i) return;
      setInfo(i);
      const pending = await B.restorePending();
      if (pending) {
        setHidden(false);
        start();
      } else if (!E.getConvs().length && (await vaultKey())) {
        setHidden(false);
      }
    })().catch(() => {});
  }, [start]);

  if (hidden || !info) return null;
  return (
    <View testID="restore-card" style={{ marginHorizontal: space.l, marginBottom: space.m, padding: space.l, gap: space.s, borderRadius: radius.md, backgroundColor: color.bgRaised, borderWidth: state === 'idle' ? 2 : 0, borderColor: color.trust }}>
      <Text style={{ ...type.headline, color: color.fgPrimary }}>{state === 'done' ? bx.restored(n) : bx.restoreTitle}</Text>
      {state === 'running' ? (
        <>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{bx.restoring(prog[0], prog[1] || 1)}</Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: color.bgBase, overflow: 'hidden' }}>
            <View style={{ height: 4, width: `${prog[1] ? Math.round((prog[0] / prog[1]) * 100) : 5}%`, backgroundColor: color.trust }} />
          </View>
        </>
      ) : state === 'done' ? (
        <Pressable accessibilityRole="button" onPress={() => setHidden(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ ...type.headline, color: color.trust }}>{tx.common.close}</Text>
        </Pressable>
      ) : (
        <>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{state === 'failed' ? bx.restoreFailed : `${bx.restoreMeta(when(info.updated_at), mb(info.bytes))}. ${bx.restoreLater}`}</Text>
          <Pressable testID="restore-start" accessibilityRole="button" onPress={start} style={({ pressed }) => ({ height: 48, borderRadius: radius.pill, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
            <Text style={{ ...type.headline, color: color.onAccent }}>{bx.restore}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

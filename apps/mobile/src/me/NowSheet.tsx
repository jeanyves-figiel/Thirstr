import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { NowStatus } from '../api/types';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Banner, Button, ErrorText, Field, Icon, SectionLabel, Segmented, Sheet } from '../ui';

const STATUSES = ['now', 'hosting', 'can_travel', 'door_open'] as const;
const HOURS = [1, 2, 3, 6];
const ICON = { now: Icon.Bolt, hosting: Icon.Home, can_travel: Icon.Car, door_open: Icon.Door } as const;

// F-09 Now status: one at a time, expires (R-09.1–R-09.3).
export function NowSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { me, refresh } = useSession();
  const [status, setStatus] = useState<NowStatus['status']>('now');
  const [hours, setHours] = useState(2);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={tx.me.now} closeLabel={tx.common.close}>
      {!me.verified ? <Banner tone="warn" text={tx.common.verifyToDo} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {STATUSES.map((st) => {
          const on = status === st;
          const I = ICON[st];
          return (
            <Pressable
              key={st}
              testID={`now-${st}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setStatus(st)}
              style={{ width: '48%', flexGrow: 1, height: 84, borderRadius: 20, padding: space.m, justifyContent: 'space-between', backgroundColor: on ? color.hookup : color.bgRaised }}
            >
              <I c={on ? color.onAccent : color.hookup} />
              <Text style={{ ...type.headline, color: on ? color.onAccent : color.fgPrimary }}>{tx.now[st]}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: space.s }}>
        <SectionLabel>{tx.me.nowFor}</SectionLabel>
        <Segmented grow label={tx.me.nowFor} value={String(hours)} onChange={(v) => setHours(Number(v))} fills={Object.fromEntries(HOURS.map((h) => [String(h), color.hookup]))} options={HOURS.map((h) => ({ value: String(h), label: tx.me.hours(h) }))} />
      </View>
      <Field label={tx.me.nowText} value={text} onChangeText={setText} maxLength={80} />
      <ErrorText text={err} />
      <View style={{ gap: space.s }}>
        <Button
          testID="now-set"
          title={tx.me.nowSet}
          fill={color.hookup}
          disabled={!me.verified}
          busy={busy}
          onPress={() => run(() => api('PUT', '/me/now', { status, ttl_s: hours * 3600, text: text.trim() || null }))}
        />
        {me.now ? <Button kind="secondary" title={tx.me.nowEnd} busy={busy} onPress={() => run(() => api('DELETE', '/me/now'))} /> : null}
      </View>
    </Sheet>
  );
}

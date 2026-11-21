import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { Banner, Button, ErrorText, Field, Loading, Sheet } from '../ui';

export type Notice = { id: string; action: string; reason: string; at: string; ends_at: string | null; appeal: string | null; seen: boolean };

const date = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

// Account status (R-AD.9 statement of reasons): every enforcement with its rule and one appeal (R-15.14).
export function NoticesScreen() {
  const [list, setList] = useState<Notice[] | null>(null);
  const [open, setOpen] = useState<Notice | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ notices: Notice[] }>('GET', '/me/notices').then(
        (r) => setList(r.notices),
        () => setList([]),
      ),
    [],
  );
  useEffect(() => {
    load().then(() => api('POST', '/me/notices/seen').catch(() => {}));
  }, [load]);

  const appeal = async () => {
    if (!open) return;
    setBusy(true);
    setErr(null);
    try {
      await api('POST', `/me/notices/${open.id}/appeal`, { text: text.trim() });
      setOpen(null);
      setText('');
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <Loading />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, gap: space.m, paddingBottom: 120 }}>
      <Text style={{ ...type.display, color: color.fgPrimary }}>{tx.notices.title}</Text>
      {list.length === 0 ? <Banner tone="trust" text={tx.notices.none} /> : null}
      {list.map((n) => (
        <View key={n.id} testID={`notice-${n.action}`} style={{ padding: space.m, borderRadius: radius.md, backgroundColor: color.bgRaised, gap: space.xs }}>
          <Text style={{ ...type.headline, color: n.action === 'warn' ? color.warn : color.danger }}>{tx.notices.actions[n.action] ?? n.action}</Text>
          <Text style={{ ...type.body, color: color.fgPrimary }}>{tx.notices.rule(tx.notices.reasons[n.reason] ?? tx.notices.reasons.other)}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>
            {date(n.at)}
            {n.ends_at ? ` · ${tx.notices.until(date(n.ends_at))}` : ''}
          </Text>
          {n.appeal ? (
            <Text style={{ ...type.meta, color: color.trust }}>{tx.notices.appealState[n.appeal]}</Text>
          ) : (
            <Button testID={`appeal-${n.action}`} small kind="secondary" title={tx.notices.appeal} onPress={() => setOpen(n)} />
          )}
        </View>
      ))}
      <Sheet visible={!!open} onClose={() => setOpen(null)} title={tx.notices.appeal} closeLabel={tx.common.close}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.notices.appealHint}</Text>
        <Field testID="appeal-text" label={tx.notices.appeal} value={text} onChangeText={setText} maxLength={1000} multiline />
        <ErrorText text={err} />
        <Button testID="appeal-send" title={tx.notices.appeal} busy={busy} disabled={!text.trim()} onPress={appeal} />
      </Sheet>
    </ScrollView>
  );
}

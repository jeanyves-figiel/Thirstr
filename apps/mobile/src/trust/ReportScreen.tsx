import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import * as E from '../chat/engine';
import { tx } from '../i18n/app';
import { color, font, space, type } from '../theme/tokens';
import { Banner, Button, Check, ErrorText, Field, Section, SectionLabel, StickyCta, Toggle } from '../ui';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void };
type Params = { profileId: string; cid?: string; messageIds?: string[]; context?: string };

const REASONS = ['spam_bot', 'scam', 'underage', 'harassment', 'non_consensual', 'hate', 'impersonation', 'other'];

const label = (m: E.Msg) => {
  const p = m.p as { t: string; text?: string };
  return p.text ?? (p.t === 'media' ? '📷' : p.t);
};

// S-50 Report (F-15 R-15.9): reason, optional note, optional franked messages, block offered.
export function ReportScreen({ navigation, route }: { navigation: Nav; route: { params: Params } }) {
  const { profileId, cid, messageIds, context } = route.params;
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [theirs, setTheirs] = useState<E.Msg[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(messageIds ?? []));
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!cid) return;
    E.messages(cid).then((l) => setTheirs(l.filter((m) => m.from === 'them' && m.raw && m.fk && (!m.by || m.by === profileId)).slice(-20).reverse()));
  }, [cid, profileId]);

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setErr(null);
    try {
      const messages = theirs.filter((m) => picked.has(m.id)).map((m) => ({ plain: m.raw, fk: m.fk }));
      await api('POST', '/reports', { profile_id: profileId, reason, note: note.trim() || undefined, context: context ?? (cid ? 'chat' : 'profile'), messages });
      if (block) await api('POST', `/profiles/${profileId}/block`).catch(() => {});
      if (block && cid) await E.setConv(cid, { archived: true });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: color.bgBase, padding: space.l, gap: space.l }}>
        <Banner tone="trust" text={tx.report.sent} />
        <Button testID="report-done" title={tx.common.done} onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
    <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: 220 }}>
      <Text accessibilityRole="header" style={{ ...type.display, color: color.fgPrimary }}>
        {tx.report.title}
      </Text>
      <View style={{ gap: space.s }}>
        <SectionLabel>{tx.report.why}</SectionLabel>
        <Section>
          {REASONS.map((r) => (
            <Radio key={r} label={tx.report.reasons[r]} on={reason === r} onPress={() => setReason(r)} />
          ))}
        </Section>
      </View>
      <Field testID="report-note" label={tx.report.note} value={note} onChangeText={setNote} maxLength={500} multiline />
      {theirs.length ? (
        <View style={{ gap: space.s }}>
          <SectionLabel>{tx.report.attach}</SectionLabel>
          <Banner tone="trust" text={tx.report.attachHint} />
          {theirs.map((m) => (
            <Check
              key={m.id}
              label={label(m)}
              on={picked.has(m.id)}
              onPress={() =>
                setPicked((s) => {
                  const n = new Set(s);
                  if (n.has(m.id)) n.delete(m.id);
                  else n.add(m.id);
                  return n;
                })
              }
            />
          ))}
        </View>
      ) : null}
      <Section>
        <Toggle label={tx.report.block} value={block} tone={color.danger} onChange={setBlock} />
      </Section>
      <ErrorText text={err} />
    </ScrollView>
      <StickyCta>
        <Button testID="report-send" title={tx.report.send} fill={color.danger} busy={busy} disabled={!reason} onPress={send} />
      </StickyCta>
    </View>
  );
}

function Radio({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56 }}>
      <Text style={{ ...type.headline, fontFamily: font.bold, color: color.fgPrimary, flex: 1 }}>{label}</Text>
      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? color.danger : color.navInactive, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color.danger }} /> : null}
      </View>
    </Pressable>
  );
}

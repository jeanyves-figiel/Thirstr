import { getLocales } from 'expo-localization';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { afterSheet, Banner, Button, ErrorText, Field, Icon, ListRow, Section, SectionLabel, Sheet } from '../ui';
import { HoldButton } from './parts';
import { Resources } from './SafeModeAuto';
import * as S from './safety';

const pill = { height: 36, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: color.line, alignItems: 'center' as const, justifyContent: 'center' as const };
const pillText = { ...type.meta, fontFamily: type.headline.fontFamily, color: color.fgPrimary };

type Nav = { navigate: (s: string, p?: object) => void };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error && e.message === 'no_contacts' ? tx.safety.needContacts : tx.common.error);

/** SOS hold + "call emergency number?" sheet (R-13.8). Shared by the hub and the due screen. */
export function Sos({ name, onSent }: { name: string; onSent?: () => void }) {
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = S.emergencyNumber(getLocales()[0]?.regionCode);
  return (
    <View style={{ gap: space.s }}>
      <HoldButton
        testID="sos"
        label={tx.safety.sos}
        badge="SOS"
        sub={tx.safety.sosHold}
        ms={2000}
        onDone={() => {
          setErr(null);
          S.panic(name).then(
            () => {
              setAsk(true);
              onSent?.();
            },
            (e) => setErr(errText(e)),
          );
        }}
      />
      <ErrorText text={err} />
      <Sheet visible={ask} onClose={() => setAsk(false)} title={tx.safety.sosSent} closeLabel={tx.common.close}>
        <Button testID="sos-call" kind="danger" title={tx.safety.call(n)} onPress={() => Linking.openURL(`tel:${n}`).finally(() => setAsk(false))} />
        <Button kind="ghost" title={tx.safety.callNo} onPress={() => setAsk(false)} />
      </Sheet>
    </View>
  );
}

// Me › Safety: trusted contacts (S-53), check-in entry (S-51), SOS, app lock.
export function SafetyScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const fallback = me.profile?.display_name ?? 'Me';
  const [list, setList] = useState<S.Contact[]>([]);
  const [act, setAct] = useState<S.Active | null>(null);
  const [orphan, setOrphan] = useState<S.Orphan | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    S.contacts().then(setList);
    S.syncActive()
      .then(async (a) => {
        setAct(a);
        setOrphan(a ? null : await S.orphanCheckin());
      })
      .catch(() => {});
    S.myName(fallback).then(setName);
  }, [fallback]);
  useFocusEffect(load);

  const share = (c: S.Contact) => Share.share({ message: tx.safety.share(S.link(c)) }).catch(() => {});

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = await S.invite(label, name || fallback);
      setAdding(false);
      setLabel('');
      load();
      // #124: share only once the sheet is gone (iOS freezes otherwise).
      afterSheet(() => share(c));
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'contacts_full' ? tx.safety.full : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const ok = list.some((c) => c.accepted);
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: 120 }}>
      <Text accessibilityRole="header" style={{ ...type.display, color: color.fgPrimary }}>
        {tx.safety.title}
      </Text>
      {act ? <Banner tone="trust" text={tx.safety.active(time(act.due))} onPress={() => navigation.navigate('CheckinDue')} /> : null}
      {orphan ? <Banner testID="checkin-orphan" tone="warn" text={tx.safety.orphanBanner(time(orphan.due))} onPress={() => navigation.navigate('CheckinDue')} /> : null}
      <Sos name={name || fallback} onSent={load} />

      <View style={{ gap: space.s }}>
        <SectionLabel>{tx.safety.checkin}</SectionLabel>
        {!ok ? <Banner tone="warn" text={tx.safety.needContacts} /> : null}
        {act || orphan ? null : <Button testID="checkin-start" kind="trust" title={tx.safety.start} disabled={!ok} onPress={() => navigation.navigate('CheckinStart', {})} />}
      </View>

      <View style={{ gap: space.s }}>
        <SectionLabel>{tx.safety.contacts}</SectionLabel>
        <Section>
          {list.map((c) => (
            <View key={c.id} testID={`contact-${c.accepted ? 'accepted' : 'pending'}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accepted ? color.trust : color.line, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...type.headline, color: c.accepted ? color.onAccent : color.fgPrimary }}>{c.label.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.headline, color: color.fgPrimary }}>{c.label}</Text>
                <Text style={{ ...type.meta, color: c.accepted ? color.trust : color.fgMuted }}>{c.accepted ? (c.push ? tx.safety.accepted : tx.safety.acceptedNoPush) : tx.safety.pending}</Text>
              </View>
              {!c.accepted ? (
                <Pressable accessibilityRole="button" onPress={() => share(c)} style={pill}>
                  <Text style={pillText}>{tx.safety.resend}</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={tx.safety.remove} onPress={() => S.removeContact(c.id).then(load)} style={[pill, { paddingHorizontal: 0, width: 36 }]}>
                <Icon.Close size={16} c={color.fgSecondary} />
              </Pressable>
            </View>
          ))}
          {list.length < 5 ? <ListRow testID="contact-add" title={tx.safety.add} sub={tx.safety.contactsHint} onPress={() => setAdding(true)} /> : null}
        </Section>
      </View>
      <Field testID="safety-name" label={tx.safety.myName} value={name} onChangeText={setName} onEndEditing={() => S.setMyName(name || fallback)} maxLength={40} />

      <Section>
        <ListRow testID="app-lock" title={tx.safety.lock.title} onPress={() => navigation.navigate('AppLock')} />
      </Section>

      <SectionLabel>{tx.safeMode.resources}</SectionLabel>
      <Section>
        <Resources />
      </Section>

      <Sheet visible={adding} onClose={() => setAdding(false)} title={tx.safety.add} closeLabel={tx.common.close}>
        <Field testID="contact-label" label={tx.safety.label} value={label} onChangeText={setLabel} maxLength={40} />
        <ErrorText text={err} />
        <Button testID="contact-invite" kind="trust" title={tx.safety.invite} busy={busy} onPress={add} />
      </Sheet>
    </ScrollView>
  );
}

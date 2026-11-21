import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { useSession } from '../app/session';
import * as E from '../chat/engine';
import { tx } from '../i18n/app';
import { dx } from '../i18n/date';
import { color, font, radius, space, type } from '../theme/tokens';
import { Banner, Button, ErrorText, Field, Loading, Toggle } from '../ui';
import { SheetFrame, useContactNames, useNow } from './live';
import { hhmm, startForChat, whoText } from './quick';
import { biometrics, checkPin, getLock, type LockCfg, waitMs } from './lock';
import { PinPad } from './parts';
import * as S from './safety';
import { Sos } from './SafetyScreen';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void; replace?: (s: string, p?: object) => void };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// S-51 v2 Check-in start sheet (#112, R-13.15): from the chat shield / chat ⋯ (includes that chat) or Me › Safety.
export function CheckinStartScreen({ navigation, route }: { navigation: Nav; route: { params?: { cid?: string } } }) {
  const { me } = useSession();
  const cid = route.params?.cid;
  const conv = cid ? E.getConv(cid) : undefined;
  const [minutes, setMinutes] = useState(120);
  const [other, setOther] = useState(false);
  const [custom, setCustom] = useState('');
  const [include, setInclude] = useState(!!conv);
  const [live, setLive] = useState(false);
  const names = useContactNames();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow();

  const m = other ? parseInt(custom, 10) : minutes;
  const valid = m >= 15 && m <= 720;
  const dueAt = (x: number) => hhmm(now + x * 60_000);

  const start = async () => {
    if (!valid) return setErr(tx.safety.custom + ': 15–720');
    setBusy(true);
    setErr(null);
    try {
      await startForChat({ cid: conv?.id, minutes: m, include, live, name: await S.myName(me.profile?.display_name ?? 'Me') });
      navigation.goBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'checkin_active' && !(await S.active())) return navigation.replace ? navigation.replace('CheckinDue') : navigation.navigate('CheckinDue');
      setErr(e instanceof ApiError ? e.message : e instanceof Error && e.message === 'no_contacts' ? tx.safety.needContacts : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const who = whoText(names ?? [], dx.and, dx.yourContacts);
  const tile = (on: boolean) => ({ flex: 1, height: 72, borderRadius: radius.md, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 2, borderWidth: on ? 0 : 1, borderColor: color.line, backgroundColor: on ? color.trust : 'transparent' });
  const tiles = [60, 120, 180];

  return (
    <SheetFrame onClose={() => navigation.goBack()} testID="checkin-sheet">
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
          {conv ? dx.meeting(conv.name) : dx.startTitle}
        </Text>
        <Text style={{ ...type.body, fontSize: 14, lineHeight: 20, color: color.fgSecondary }}>{dx.startBody(who, names?.length ?? 0)}</Text>
      </View>
      {names === null ? null : !names.length ? (
        <>
          <Banner tone="warn" text={tx.safety.needContacts} />
          <Button kind="trust" title={tx.safety.add} onPress={() => navigation.navigate('Safety')} />
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space.s }} accessibilityRole="radiogroup">
            {tiles.map((x) => {
              const on = !other && minutes === x;
              return (
                <Pressable key={x} testID={`checkin-${x}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => (setOther(false), setMinutes(x))} style={tile(on)}>
                  <Text style={{ ...type.title, fontSize: 20, color: on ? color.onAccent : color.fgPrimary }}>{tx.safety.presets[x]}</Text>
                  <Text style={{ ...type.caption, fontFamily: font.bold, color: on ? color.onAccent : color.fgSecondary }}>{dueAt(x)}</Text>
                </Pressable>
              );
            })}
            <Pressable testID="checkin-other" accessibilityRole="radio" accessibilityState={{ selected: other }} onPress={() => setOther(true)} style={tile(other)}>
              <Text style={{ ...type.headline, fontSize: 17, color: other ? color.onAccent : color.fgPrimary }}>{dx.other}</Text>
              <Text style={{ ...type.caption, fontFamily: font.bold, color: other ? color.onAccent : color.fgSecondary }}>{other && valid ? dueAt(m) : '15–720′'}</Text>
            </Pressable>
          </View>
          {other ? <Field testID="checkin-custom" label={tx.safety.custom} value={custom} onChangeText={(v) => setCustom(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" autoFocus /> : null}
          <View style={{ backgroundColor: color.bgBase, borderRadius: radius.md, paddingHorizontal: space.l, paddingVertical: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, borderBottomWidth: 1, borderColor: color.lineSubtle }}>
              <View style={{ flexDirection: 'row' }}>
                {names.slice(0, 3).map((n, i) => (
                  <View key={i} style={{ width: 30, height: 30, borderRadius: 15, marginLeft: i ? -8 : 0, borderWidth: 2, borderColor: color.bgBase, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...type.caption, fontSize: 13, color: color.onAccent }}>{n.slice(0, 1).toUpperCase()}</Text>
                  </View>
                ))}
              </View>
              <Text style={{ ...type.meta, fontSize: 14, color: color.fgPrimary, flex: 1 }}>{dx.notice(who, names.length)}</Text>
            </View>
            {conv ? <Toggle label={dx.includeChat(conv.name)} value={include} onChange={setInclude} tone={color.trust} /> : null}
            <Toggle label={dx.live} value={live} onChange={setLive} tone={color.trust} />
          </View>
          <Text style={{ ...type.meta, color: color.fgMuted }}>{tx.safety.killedNote}</Text>
          <ErrorText text={err} />
          <Button testID="checkin-go" kind="trust" title={valid ? dx.startDue(dueAt(m)) : tx.safety.go} busy={busy} disabled={!valid} onPress={start} />
        </>
      )}
    </SheetFrame>
  );
}

// S-52 Check-in due: I'm OK (PIN / biometrics), +30 min, SOS. Duress PIN looks identical (AC-13.3).
// #127, R-13.21: also ends a check-in the server still runs after this phone lost its copy.
export function CheckinDueScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const myName = me.profile?.display_name ?? 'Me';
  const [act, setAct] = useState<S.Active | null | undefined>(undefined);
  const [orphan, setOrphan] = useState<S.Orphan | null>(null);
  const [cfg, setCfg] = useState<LockCfg | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    S.syncActive()
      .then(async (a) => {
        if (!a) setOrphan(await S.orphanCheckin());
        setAct(a);
      })
      .catch(() => setAct(null));
    getLock().then(setCfg);
  }, []);

  const ok = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (act) await S.okCheckin().catch(() => {});
      else await S.endOrphan(myName);
      setDone(true);
    } catch {
      // Orphan not ended: say so, the alert would still fire (R-13.21).
      setErr(tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const pin = async (p: string) => {
    if (!cfg) return;
    const r = await checkPin(cfg, p);
    if (r === 'ok') return ok();
    if (r === 'duress') {
      // Same screen as OK; the alert leaves silently (R-13.9).
      setDone(true);
      S.panic(myName).catch(() => {});
      return;
    }
    setErr(r === 'wait' ? tx.safety.lock.wait(Math.ceil((await waitMs()) / 1000)) : tx.safety.lock.wrong);
  };

  const more = async () => {
    setErr(null);
    try {
      setAct(await S.extendCheckin());
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'max_extensions' ? tx.safety.maxExt : tx.common.error);
    }
  };

  if (done)
    return (
      <View style={{ flex: 1, backgroundColor: color.bgBase, padding: space.l, gap: space.l, justifyContent: 'center' }}>
        <Banner tone="trust" text={tx.safety.okDone} />
        <Button testID="checkin-done" title={tx.common.done} onPress={() => navigation.goBack()} />
      </View>
    );
  if (act === undefined) return <Loading />;
  const due = act?.due ?? orphan?.due;
  if (!due)
    return (
      <View style={{ flex: 1, backgroundColor: color.bgBase, padding: space.l, gap: space.l }}>
        <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.safety.contactsHint}</Text>
        <Button title={tx.common.back} onPress={() => navigation.goBack()} />
      </View>
    );

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, gap: space.l, paddingBottom: 120 }}>
      <Text style={{ ...type.display, color: color.fgPrimary }}>{act ? tx.safety.allGood : tx.safety.orphanTitle}</Text>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{act ? tx.safety.allGoodBody : tx.safety.orphanBody(time(new Date(new Date(due).getTime() + 15 * 60_000).toISOString()))}</Text>
      <Text style={{ ...type.meta, color: color.trust }}>{tx.safety.active(time(due))}</Text>
      {cfg ? (
        <PinPad
          title={tx.safety.imOk}
          error={err}
          onDone={pin}
          extra={cfg.bio ? <Button small kind="ghost" title={tx.safety.lock.useBio} onPress={() => biometrics(tx.safety.imOk).then((y) => (y ? ok() : undefined))} /> : null}
        />
      ) : (
        <>
          <Button testID="checkin-ok" kind="trust" title={tx.safety.imOk} busy={busy} onPress={ok} />
          <ErrorText text={err} />
        </>
      )}
      {act && act.ext < 3 ? <Button testID="checkin-more" kind="secondary" title={tx.safety.more} onPress={more} /> : null}
      <Sos name={act?.name ?? myName} onSent={() => navigation.goBack()} />
    </ScrollView>
  );
}

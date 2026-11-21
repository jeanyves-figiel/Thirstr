import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { BackButton, Banner, Button, ErrorText, Field, StickyCta, useAccent, useNavSpace } from '../ui';
import { FormLabel, IconChoice, IconTiles, Stepper, TimeRange, haptic, type IconOption } from '../ui/form';
import { Icon } from '../ui/icons';
import { dayWord, fit, hhmm, lenLabel, partyDefault, partyLimits, type PartyDay, type Win } from './timeWindow';
import type { Party } from './types';

type Nav = {
  navigate: (s: string, p?: object) => void;
  replace: (s: string, p?: object) => void;
  goBack: () => void;
};
type Aud = 'verified' | 'chats' | 'invite';

const RULES: IconOption<string>[] = [
  { value: 'age_range', label: tx.party.rule.age_range, icon: (c) => <Icon.Age c={c} /> },
  { value: 'safer', label: tx.party.rule.safer, icon: (c) => <Icon.Shield size={22} c={c} /> },
  { value: 'prep', label: tx.party.rule.prep, icon: (c) => <Icon.Pill c={c} /> },
  { value: 'vers_welcome', label: tx.party.rule.vers_welcome, icon: (c) => <Icon.Vers c={c} /> },
  { value: 'no_chems', label: tx.party.rule.no_chems, icon: (c) => <Icon.Ban size={22} c={c} /> },
  { value: 'sober_friendly', label: tx.party.rule.sober_friendly, icon: (c) => <Icon.Glass c={c} /> },
  { value: 'bring_toys', label: tx.party.rule.bring_toys, icon: (c) => <Icon.Toy c={c} /> },
  { value: 'dress_code', label: tx.party.rule.dress_code, icon: (c) => <Icon.Shirt c={c} /> },
];
const CHIPS = RULES.map((r) => r.value);
const AUDS: IconOption<Aud>[] = [
  { value: 'verified', label: tx.tonight.audiences.verified, icon: (c) => <Icon.Shield size={22} c={c} /> },
  { value: 'chats', label: tx.tonight.audiences.chats, icon: (c) => <Icon.Chat c={c} /> },
  { value: 'invite', label: tx.tonight.audiences.invite, icon: (c) => <Icon.Lock size={22} c={c} /> },
];

// S-15 Host a party (R-10.1, #189). Approximate area is taken from your location (r8 cell), never an address.
export function PartyNewScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const nav = useNavSpace();
  const [now] = useState(() => Date.now());
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<PartyDay>('tonight');
  const [win, setWin] = useState<Win>(() => partyDefault(now, 'tonight'));
  const [cap, setCap] = useState(6);
  const [rules, setRules] = useState<string[]>(['safer']);
  const [custom, setCustom] = useState('');
  const [aud, setAud] = useState<Aud>('verified');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const safe = me.safe_mode === 'on' || me.safe_mode_active;
  const limits = partyLimits(now, day);
  const customRules = rules.filter((r) => !CHIPS.includes(r));
  const len = lenLabel(win.e - win.s, tx.tonight.hUnit, tx.tonight.minUnit);

  const pickDay = (d: PartyDay) => {
    if (d === day) return;
    haptic.tick();
    setDay(d);
    setWin(fit(partyDefault(now, d), partyLimits(now, d)));
  };
  const addCustom = () => {
    const r = custom.trim();
    if (!r || rules.includes(r) || customRules.length >= 3) return;
    haptic.tick();
    setRules([...rules, r]);
    setCustom('');
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await api<Party>('POST', '/parties', {
        title: title.trim(),
        starts_at: new Date(win.s).toISOString(),
        ends_at: new Date(win.e).toISOString(),
        capacity: cap,
        rules,
        audience: aud,
      });
      haptic.success();
      navigation.replace('Party', { id: p.id });
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const ruleLabels = [...RULES.filter((r) => rules.includes(r.value)).map((r) => r.label), ...customRules];

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.s, gap: space.xl, paddingBottom: nav.bottom + 56 + space.huge + space.xl }}
      >
        {/* #189: title in the header row, never scrolled away under the back button. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 44 }}>
          <BackButton onPress={() => navigation.goBack()} label={tx.common.back} />
          <Text accessibilityRole="header" style={{ ...type.title, flex: 1, color: color.fgPrimary }} numberOfLines={1}>
            {tx.party.create}
          </Text>
        </View>
        {safe ? <Banner tone="personal" text={tx.party.safeMode} /> : null}

        {/* Live preview of the featured card (R-09.7). */}
        <View testID="party-preview" style={{ marginTop: space.s, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, backgroundColor: color.bgRaised, padding: space.m + 2, flexDirection: 'row', gap: space.m }}>
          <View style={{ position: 'absolute', top: -9, left: space.m + 2, backgroundColor: color.bgBase, borderColor: color.line, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 }}>
            <Text style={{ ...type.caption, fontSize: 10, color: color.fgMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{tx.party.preview}</Text>
          </View>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Party size={26} c={color.onAccent} />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ ...type.headline, color: color.fgPrimary }} numberOfLines={1}>
              {title.trim() || tx.party.untitled}
            </Text>
            <Text style={{ ...type.meta, fontFamily: font.bold, color: color.fgSecondary }}>
              {`${tx.party.day[dayWord(now, day)]} ${hhmm(win.s)} – ${hhmm(win.e)} · ${tx.party.seats(0, cap)}`}
            </Text>
            {ruleLabels.length ? (
              <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted }} numberOfLines={2}>
                {ruleLabels.join(' · ')}
              </Text>
            ) : null}
          </View>
        </View>

        <Field testID="party-title" label={tx.party.name} placeholder={tx.party.titleHint} value={title} onChangeText={setTitle} maxLength={40} hint={`${title.length}/40`} />

        <View>
          <FormLabel label={tx.tonight.when} value={len} />
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.s }} accessibilityRole="radiogroup">
            {(['tonight', 'tomorrow'] as const).map((d) => (
              <Pressable
                key={d}
                testID={`party-day-${d}`}
                onPress={() => pickDay(d)}
                accessibilityRole="radio"
                accessibilityState={{ checked: day === d }}
                style={{ height: 32, paddingHorizontal: space.m, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: day === d ? color.bgInverse : color.bgRaised }}
              >
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: day === d ? color.onAccent : color.fgSecondary }}>{tx.party.day[dayWord(now, d)]}</Text>
              </Pressable>
            ))}
          </View>
          <TimeRange
            testID="party-window"
            limits={limits}
            value={win}
            onChange={setWin}
            accent={accent}
            hint={tx.tonight.rangeHint}
            labels={{ start: tx.tonight.start, end: tx.tonight.end, h: tx.tonight.hUnit, min: tx.tonight.minUnit }}
          />
        </View>

        <View>
          <FormLabel label={tx.party.capacity} value="2–50" />
          <Stepper testID="party-cap" value={cap} min={2} max={50} onChange={setCap} accent={accent} sub={tx.party.guestsSub} labels={{ less: tx.party.fewer, more: tx.party.more, name: tx.party.capacity }} />
        </View>

        <View>
          <FormLabel label={tx.party.houseRules} value={tx.party.rulesOn(rules.length)} />
          <IconTiles testID="party-rules" options={RULES} selected={rules} onToggle={(r) => setRules(rules.includes(r) ? rules.filter((x) => x !== r) : [...rules, r])} fill={accent} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.s, alignItems: 'center' }}>
            {customRules.map((r) => (
              <Pressable
                key={r}
                onPress={() => setRules(rules.filter((x) => x !== r))}
                accessibilityRole="button"
                accessibilityLabel={tx.party.removeRule(r)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingLeft: space.m, paddingRight: 6, borderRadius: radius.pill, backgroundColor: accent }}
              >
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: color.onAccent }}>{r}</Text>
                <Icon.Close size={14} c={color.onAccent} />
              </Pressable>
            ))}
            {customRules.length < 3 ? (
              <View style={{ flexGrow: 1, minWidth: 180, flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.line, backgroundColor: color.bgRaised, paddingLeft: space.m + 2, paddingRight: 5 }}>
                <TextInput
                  testID="party-custom-rule"
                  value={custom}
                  onChangeText={setCustom}
                  maxLength={30}
                  placeholder={tx.party.addOwn(3 - customRules.length)}
                  placeholderTextColor={color.fgMuted}
                  returnKeyType="done"
                  onSubmitEditing={addCustom}
                  blurOnSubmit={false}
                  accessibilityLabel={tx.party.customRule}
                  style={{ flex: 1, fontFamily: font.regular, fontSize: 14, color: color.fgPrimary, paddingVertical: 0 }}
                />
                <Pressable
                  onPress={addCustom}
                  disabled={!custom.trim()}
                  accessibilityRole="button"
                  accessibilityLabel={tx.party.addRule}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: custom.trim() ? accent : color.bgOverlay }}
                >
                  <Icon.Plus size={16} c={custom.trim() ? color.onAccent : color.fgMuted} />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        <View>
          <FormLabel label={tx.tonight.audience} />
          <IconChoice testID="party-aud" label={tx.tonight.audience} options={AUDS} value={aud} onChange={setAud} fill={color.trust} />
        </View>

        <Banner tone="trust" text={tx.party.area} />
        <ErrorText text={err} />
      </ScrollView>
      <StickyCta>
        <Button testID="party-create" title={title.trim() ? `${tx.party.create} · ${hhmm(win.s)} · ${cap}` : tx.party.create} busy={busy} disabled={!title.trim() || safe} onPress={create} />
      </StickyCta>
    </View>
  );
}

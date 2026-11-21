import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, Me } from '../api/client';
import { t } from '../i18n/strings';
import { months, o } from '../i18n/onboarding';
import { ageOn, BASICS_STEPS, BasicsStep, basicsValid, daysIn, isoBirthday, NAME_MAX, nameValid, parseBirthday, STEP_OF } from '../onboarding/flow';
import { Enter, k, OptionPill, ROW, StepShell, tick, WheelColumn } from '../onboarding/kit';
import { color, font, radius, space } from '../theme/tokens';
import { ErrorText } from '../ui';

// S-03a…d (F-02 R-02.1c–f, R-02.4, R-02.5): one question per screen; one PUT /me/basics at the end.
// RF-3 (required-fields.md): optional; "Prefer not to say" stores unspecified.
const GENDERS = ['man', 'trans_man', 'non_binary', 'other', 'unspecified'];
const HERE: [string, string][] = [
  ['hookup', color.hookup],
  ['tonight', color.hookup],
  ['chat', color.friends],
  ['friends', color.friends],
  ['sport', color.sport],
];

export function BasicsScreen({ me, onDone, onUnderage }: { me: Me; onDone: (me: Me) => void; onUnderage: () => void }) {
  const today = useMemo(() => new Date(), []);
  const maxYear = today.getFullYear() - 18;
  const years = useMemo(() => Array.from({ length: maxYear - 1930 + 1 }, (_, i) => String(1930 + i)), [maxYear]);

  const [step, setStep] = useState<BasicsStep>('name');
  const [name, setName] = useState(me.profile?.display_name ?? '');
  const [y, setY] = useState(maxYear - 7);
  const [m, setM] = useState(0);
  const [d, setD] = useState(1);
  const [gender, setGender] = useState(me.profile?.gender ?? '');
  const [other, setOther] = useState(me.profile?.gender_other ?? '');
  const [here, setHere] = useState<string[]>(me.onboarding_step === 'basics' ? [] : (me.profile?.here_for ?? [])) // RF-4: nothing pre-selected;
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const birthdate = isoBirthday(y, m, d);
  const age = ageOn(parseBirthday(birthdate)!, today);
  const days = useMemo(() => Array.from({ length: daysIn(y, m) }, (_, i) => String(i + 1)), [y, m]);
  const go = (s: BasicsStep) => setStep(s);
  const back = () => go(BASICS_STEPS[Math.max(0, BASICS_STEPS.indexOf(step) - 1)]);
  const input = { display_name: name.trim(), birthdate, gender, gender_other: gender === 'other' ? other.trim() : '', here_for: here };

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      onDone(await api<Me>('PUT', '/me/basics', input));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'underage') return onUnderage();
      if (e instanceof ApiError && e.fields?.display_name) go('name');
      setErr(e instanceof ApiError ? e.message : t.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'name') {
    const ok = nameValid(name);
    return (
      <StepShell step={STEP_OF.name} title={o.name.title} sub={o.name.sub} cta={{ title: o.cont, testID: 'name-continue', disabled: !ok, onPress: () => go('birthday') }}>
        <TextInput
          testID="name"
          accessibilityLabel={o.name.ph}
          value={name}
          onChangeText={(v) => setName(v.slice(0, NAME_MAX))}
          placeholder={o.name.ph}
          placeholderTextColor={color.navInactive}
          autoFocus
          autoComplete="given-name"
          textContentType="givenName"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => ok && go('birthday')}
          selectionColor={color.hookup}
          maxLength={NAME_MAX}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[b.name, focus && { borderBottomColor: color.hookup }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        />
        <Text style={b.counter}>{name.length}/{NAME_MAX}</Text>
        <ErrorText text={err} />
      </StepShell>
    );
  }

  if (step === 'birthday') {
    const adult = age >= 18;
    return (
      <StepShell step={STEP_OF.birthday} onBack={back} title={o.birthday.title(name.trim())} sub={o.birthday.sub} cta={{ title: o.cont, testID: 'birthday-continue', onPress: () => (adult ? go('identity') : onUnderage()) }}>
        <View style={b.wheel}>
          <View pointerEvents="none" style={b.wheelBand} />
          <WheelColumn label={o.birthday.day} items={days} index={Math.min(d, days.length) - 1} onChange={(i) => setD(i + 1)} />
          <WheelColumn label={o.birthday.month} items={months} index={m} onChange={setM} flex={1.7} />
          <WheelColumn label={o.birthday.year} items={years} index={y - 1930} onChange={(i) => setY(1930 + i)} flex={1.3} />
        </View>
        <View style={[b.ageChip, { backgroundColor: adult ? 'rgba(61,214,195,0.14)' : 'rgba(255,77,109,0.14)' }]} accessibilityLiveRegion="polite">
          <Text style={[b.ageText, { color: adult ? color.trust : color.danger }]}>{adult ? o.birthday.age(age) : o.birthday.tooYoung}</Text>
        </View>
      </StepShell>
    );
  }

  if (step === 'identity') {
    const ok = !!gender && (gender !== 'other' || (other.trim().length >= 1 && other.length <= 20));
    return (
      <StepShell step={STEP_OF.identity} onBack={back} title={o.identity.title} sub={o.identity.sub} scroll cta={{ title: o.cont, testID: 'identity-continue', disabled: !ok, onPress: () => go('herefor') }}>
        <View style={b.list} accessibilityRole="radiogroup">
          {GENDERS.map((g) => (
            <OptionPill
              key={g}
              testID={`gender-${g}`}
              label={o.identity.options[g]}
              on={gender === g}
              onPress={() => {
                tick();
                setGender(g);
                if (g !== 'other') setTimeout(() => setStep((s) => (s === 'identity' ? 'herefor' : s)), 380);
              }}
            />
          ))}
        </View>
        {gender === 'other' ? (
          <Enter>
            <TextInput
              testID="gender-other"
              accessibilityLabel={o.identity.otherPh}
              value={other}
              onChangeText={(v) => setOther(v.slice(0, 20))}
              placeholder={o.identity.otherPh}
              placeholderTextColor={color.fgMuted}
              maxLength={20}
              autoFocus
              selectionColor={color.hookup}
              style={b.other}
            />
          </Enter>
        ) : null}
      </StepShell>
    );
  }

  // herefor
  const ok = basicsValid(input);
  return (
    <StepShell step={STEP_OF.herefor} onBack={back} title={o.herefor.title} sub={o.herefor.sub} scroll cta={{ title: o.cont, testID: 'basics-continue', disabled: !ok, busy, onPress: submit }}>
      <View style={b.tiles}>
        {HERE.map(([key, fill], i) => {
          const on = here.includes(key);
          const [label, sub] = o.herefor.tiles[key];
          return (
            <Pressable
              key={key}
              testID={`here-${key}`}
              accessibilityRole="checkbox"
              accessibilityLabel={`${label}. ${sub}`}
              accessibilityState={{ checked: on }}
              onPress={() => {
                tick();
                setHere(on ? here.filter((x) => x !== key) : [...here, key]);
              }}
              style={({ pressed }) => [b.tile, i === 4 && b.tileWide, on ? { backgroundColor: fill, borderColor: fill } : null, pressed && k.pressed]}
            >
              <View style={b.tileTop}>
                <View style={[b.dot, { backgroundColor: on ? color.onAccent : fill }]} />
                {on ? <Text style={b.check}>✓</Text> : null}
              </View>
              <View>
                <Text style={[b.tileLabel, on && { color: color.onAccent }]}>{label}</Text>
                <Text style={[b.tileSub, on && { color: color.onAccent }]}>{sub}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <ErrorText text={err} />
    </StepShell>
  );
}

export function UnderageScreen() {
  return (
    <StepShell title={o.underage.title} sub={o.underage.body}>
      <View style={b.clock}>
        <Text style={b.clockText}>18</Text>
      </View>
    </StepShell>
  );
}

const b = StyleSheet.create({
  name: { marginTop: space.xxl, fontFamily: font.heavy, fontSize: 34, letterSpacing: -0.7, color: color.fgPrimary, paddingVertical: space.s, borderBottomWidth: 2, borderBottomColor: color.line },
  counter: { alignSelf: 'flex-end', fontFamily: font.medium, fontSize: 13, color: color.fgMuted, fontVariant: ['tabular-nums'] },
  wheel: { marginTop: space.xl, flexDirection: 'row', gap: 6, position: 'relative' },
  wheelBand: { position: 'absolute', left: 0, right: 0, top: ROW * 2, height: ROW, borderRadius: radius.pill, backgroundColor: color.bgRaised },
  ageChip: { marginTop: space.l, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  ageText: { fontFamily: font.bold, fontSize: 15 },
  list: { marginTop: space.m, gap: 10 },
  other: { minHeight: 56, borderRadius: radius.pill, borderWidth: 2, borderColor: color.line, backgroundColor: color.bgRaised, color: color.fgPrimary, fontFamily: font.regular, fontSize: 17, paddingHorizontal: 22 },
  tiles: { marginTop: space.s, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', minHeight: 112, borderRadius: radius.tray, padding: space.l, backgroundColor: color.bgRaised, borderWidth: 2, borderColor: color.bgRaised, justifyContent: 'space-between', gap: 10 },
  tileWide: { width: '100%', minHeight: 80 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  check: { fontFamily: font.heavy, fontSize: 13, color: color.onAccent },
  tileLabel: { fontFamily: font.heavy, fontSize: 19, letterSpacing: -0.4, color: color.fgPrimary },
  tileSub: { fontFamily: font.medium, fontSize: 13, lineHeight: 17, color: color.fgSecondary },
  clock: { marginTop: space.xxl, width: 72, height: 72, borderRadius: 36, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' },
  clockText: { fontFamily: font.heavy, fontSize: 24, color: color.personal },
});

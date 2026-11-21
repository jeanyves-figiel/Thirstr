import { getLocales } from 'expo-localization';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../api/client';
import type { Trip } from '../api/types';
import { tx } from '../i18n/app';
import { tr } from '../i18n/travel';
import { isSafeModeCountry } from '../safety/criminalizing';
import { color, radius, space, type } from '../theme/tokens';
import { Button, ErrorText, Icon, Label, Segmented, Sheet, Toggle } from '../ui';
import { addDays, createTrip, daysBetween, deleteTrip, isoDay, parseDay, rangeLabel, today, TravelLabel, updateTrip } from './travel';

type City = { id: number; name: string; country: string };
type When = '14' | '7' | '3' | '0';
const WHEN: When[] = ['14', '7', '3', '0'];
const AHEAD = 180;
const MAX_DAYS = 30;

const locale = getLocales()[0]?.languageTag ?? 'en';
const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
const wdFmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
// Monday-first week header (2024-01-01 was a Monday).
const WEEK = Array.from({ length: 7 }, (_, i) => wdFmt.format(new Date(2024, 0, 1 + i, 12)));

// S-73 Trip sheet (F-20 R-20.2–R-20.5, R-20.19).
export function TripSheet({
  trip,
  visible,
  verified,
  home,
  onClose,
  onSaved,
}: {
  trip: Trip | null;
  visible: boolean;
  verified: boolean;
  home: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [city, setCity] = useState<City | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<City[] | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [when, setWhen] = useState<When>('7');
  const [sayFrom, setSayFrom] = useState(false);
  const [month, setMonth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [safeAsk, setSafeAsk] = useState(false);

  // Reset the draft whenever the sheet opens or switches trip.
  const [seen, setSeen] = useState<{ trip: Trip | null; visible: boolean }>({ trip, visible });
  if (seen.trip !== trip || seen.visible !== visible) {
    setSeen({ trip, visible });
    setCity(trip ? { id: trip.city.id, name: trip.city.name, country: trip.city.country } : null);
    setQ('');
    setFound(null);
    setFirst(trip?.first_day ?? null);
    setLast(trip?.last_day ?? null);
    setShow(verified && trip ? trip.show_days !== null : false);
    setWhen(trip?.show_days != null ? (String(trip.show_days) as When) : '7');
    setSayFrom(trip?.say_from ?? false);
    setMonth(trip ? Math.max(0, monthsFrom(today(), parseDay(trip.first_day))) : 0);
    setErr(null);
    setConfirmDel(false);
    setSafeAsk(false);
  }

  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) return setFound(null);
    try {
      const r = await api<{ cities: City[] }>('GET', '/cities?q=' + encodeURIComponent(v.trim()));
      setFound(r.cities.slice(0, 6));
    } catch {
      setFound([]);
    }
  }

  function pickDay(s: string) {
    setErr(null);
    if (!first || last || s < first) {
      setFirst(s);
      setLast(null);
      return;
    }
    if (daysBetween(parseDay(first), parseDay(s)) + 1 > MAX_DAYS) return setErr(tr.tooLong);
    setLast(s);
  }

  const end = last ?? first;
  const ready = !!city && !!first && !!end;
  const showing = verified && show;
  const preview = ready ? tr.visitingCity(city!.name, rangeLabel(first!, end!), sayFrom && home ? home : null) : null;

  async function save(ack = false) {
    if (!ready) return;
    if (showing && !ack && isSafeModeCountry(city!.country) && !(trip?.safe_mode_country && trip.show_days !== null)) return setSafeAsk(true);
    setBusy(true);
    setErr(null);
    const body = { city_id: city!.id, first_day: first!, last_day: end!, show_days: showing ? Number(when) : null, say_from: showing && sayFrom, ...(ack ? { safe_mode_ack: true } : {}) };
    try {
      if (trip) await updateTrip(trip.id, body);
      else await createTrip(body);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.fields?.safe_mode_ack) setSafeAsk(true);
      else setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!trip) return;
    setBusy(true);
    try {
      await deleteTrip(trip.id);
      onSaved();
    } catch {
      setErr(tx.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={trip ? tr.editTrip : tr.newTrip} closeLabel={tx.common.close}>
      {/* City */}
      <View style={{ gap: space.s }}>
        <Label>{tr.city}</Label>
        {city && found === null ? (
          <Pressable
            testID="trip-city"
            accessibilityRole="button"
            accessibilityLabel={`${tr.city}: ${city.name}`}
            onPress={() => setFound([])}
            style={rowBox}
          >
            <Text style={{ ...type.headline, color: color.fgPrimary, flex: 1 }}>{city.name}</Text>
            <Text style={{ ...type.meta, color: color.fgMuted }}>{city.country}</Text>
            <Icon.Next />
          </Pressable>
        ) : (
          <>
            <View style={rowBox}>
              <Icon.Search />
              <TextInput
                testID="trip-city-search"
                autoFocus={!!city}
                value={q}
                onChangeText={search}
                placeholder={tr.citySearch}
                placeholderTextColor={color.fgMuted}
                accessibilityLabel={tr.citySearch}
                autoCorrect={false}
                style={{ ...type.body, color: color.fgPrimary, flex: 1, paddingVertical: 0 }}
              />
            </View>
            {found?.map((c) => (
              <Pressable
                key={c.id}
                testID={`trip-city-${c.id}`}
                accessibilityRole="button"
                onPress={() => {
                  setCity(c);
                  setFound(null);
                  setQ('');
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, paddingHorizontal: space.m, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ ...type.body, color: color.fgPrimary, flex: 1 }}>{c.name}</Text>
                <Text style={{ ...type.meta, color: color.fgMuted }}>{c.country}</Text>
              </Pressable>
            ))}
            {found && found.length === 0 && q.trim().length >= 2 ? <Text style={{ ...type.meta, color: color.fgMuted, paddingHorizontal: space.m }}>{tr.noCity}</Text> : null}
            {/* CC BY 4.0 attribution for the city catalogue. */}
            <Text style={{ ...type.meta, fontSize: 11, color: color.fgMuted, paddingHorizontal: space.m }}>Cities: GeoNames.org (CC BY 4.0)</Text>
          </>
        )}
      </View>

      {/* Dates */}
      <View style={{ gap: space.s }}>
        <Label>{tr.dates}</Label>
        <Calendar month={month} setMonth={setMonth} first={first} last={end} onPick={pickDay} />
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted }}>{first && end ? rangeLabel(first, end) : tr.datesHint}</Text>
      </View>

      {/* Visibility */}
      <View style={{ gap: space.s }}>
        <Toggle
          label={tr.showMe(city?.name ?? '…')}
          sub={verified ? tr.showMeSub : tr.showMeVerify}
          value={showing}
          disabled={!verified}
          tone={color.travel}
          onChange={setShow}
        />
        {showing ? (
          <>
            <Segmented<When> label={tr.showMe(city?.name ?? '…')} value={when} onChange={setWhen} options={WHEN.map((w) => ({ value: w, label: tr.when[Number(w)] }))} fills={{ '14': color.travel, '7': color.travel, '3': color.travel, '0': color.travel }} grow />
            <Toggle label={tr.sayFrom} sub={home ? tr.sayFromSub(home) : tr.sayFromAny} value={sayFrom} tone={color.travel} onChange={setSayFrom} />
          </>
        ) : null}
      </View>

      {/* Preview (R-20.6) */}
      {showing && preview ? (
        <View style={{ gap: space.s, padding: space.m, borderRadius: radius.md, backgroundColor: color.travelSoft }}>
          <Text style={{ ...type.caption, color: color.travel, letterSpacing: 0.6, textTransform: 'uppercase' }}>{tr.guysSee(city!.name)}</Text>
          <TravelLabel text={preview} />
        </View>
      ) : null}

      {safeAsk ? (
        <View testID="trip-safe-ask" accessibilityRole="alert" style={{ gap: space.s, padding: space.m, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.danger, backgroundColor: `${color.danger}14` }}>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>{tr.safeTitle(city!.name)}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{tr.safeBody}</Text>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Button small kind="secondary" title={tr.cancel} onPress={() => setSafeAsk(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button small kind="danger" testID="trip-safe-yes" title={tr.safeYes} busy={busy} onPress={() => save(true)} />
            </View>
          </View>
        </View>
      ) : null}

      <ErrorText text={err} />

      {!safeAsk ? <Button testID="trip-save" title={trip ? tr.saveEdit : tr.save} fill={color.travel} disabled={!ready} busy={busy && !confirmDel} onPress={() => save()} /> : null}

      {trip ? (
        confirmDel ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>{tr.deleteConfirm}</Text>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <View style={{ flex: 1 }}>
                <Button small kind="secondary" title={tr.cancel} onPress={() => setConfirmDel(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button small kind="danger" testID="trip-delete-yes" title={tr.delete} busy={busy} onPress={remove} />
              </View>
            </View>
          </View>
        ) : (
          <Button testID="trip-delete" kind="ghost" title={tr.delete} onPress={() => setConfirmDel(true)} />
        )
      ) : null}
    </Sheet>
  );
}

const rowBox = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.s, minHeight: 48, paddingHorizontal: space.m, borderRadius: radius.sm, backgroundColor: color.bgRaised };

const monthsFrom = (a: Date, b: Date) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

/** Month grid, today … today+180, range in sky. */
function Calendar({ month, setMonth, first, last, onPick }: { month: number; setMonth: (m: number) => void; first: string | null; last: string | null; onPick: (s: string) => void }) {
  const t0 = today();
  const min = isoDay(t0);
  const max = isoDay(addDays(t0, AHEAD));
  const maxMonth = monthsFrom(t0, addDays(t0, AHEAD));
  const base = new Date(t0.getFullYear(), t0.getMonth() + month, 1, 12);
  const y = base.getFullYear();
  const m = base.getMonth();
  const cells = (() => {
    const base = new Date(y, m, 1, 12);
    const lead = (base.getDay() + 6) % 7;
    const n = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let i = 1; i <= n; i++) out.push(isoDay(new Date(base.getFullYear(), base.getMonth(), i, 12)));
    while (out.length % 7) out.push(null);
    return out;
  })();

  const nav = (d: number, label: string, on: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !on }}
      disabled={!on}
      onPress={() => setMonth(month + d)}
      hitSlop={8}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: on ? 1 : 0.3 }}
    >
      <Icon.Chevron size={18} d={d < 0 ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </Pressable>
  );

  return (
    <View testID="trip-calendar" style={{ padding: space.s, borderRadius: radius.md, backgroundColor: color.bgRaised, gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {nav(-1, tr.prevMonth, month > 0)}
        <Text style={{ ...type.headline, color: color.fgPrimary, flex: 1, textAlign: 'center', textTransform: 'capitalize' }}>{monthFmt.format(base)}</Text>
        {nav(1, tr.nextMonth, month < maxMonth)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {WEEK.map((w, i) => (
          <Text key={i} style={{ ...type.caption, color: color.fgMuted, flex: 1, textAlign: 'center' }}>
            {w}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((s, i) => {
          if (!s) return <View key={i} style={{ width: `${100 / 7}%`, height: 40 }} />;
          const off = s < min || s > max;
          const edge = s === first || s === last;
          const inside = !!first && !!last && s > first && s < last;
          const dayN = Number(s.slice(8));
          return (
            <View key={s} style={{ width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: inside || (edge && first !== last) ? color.travelSoft : 'transparent', borderTopLeftRadius: s === first ? 20 : 0, borderBottomLeftRadius: s === first ? 20 : 0, borderTopRightRadius: s === last ? 20 : 0, borderBottomRightRadius: s === last ? 20 : 0 }}>
              <Pressable
                testID={`day-${s}`}
                accessibilityRole="button"
                accessibilityLabel={s}
                accessibilityState={{ selected: edge || inside, disabled: off }}
                disabled={off}
                onPress={() => onPick(s)}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: edge ? color.travel : 'transparent' }}
              >
                <Text style={{ ...type.meta, fontVariant: ['tabular-nums'], color: edge ? color.onAccent : off ? color.fgMuted : color.fgPrimary, opacity: off ? 0.4 : 1, fontFamily: edge ? type.headline.fontFamily : type.meta.fontFamily }}>{dayN}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

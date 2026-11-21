import { getLocales } from 'expo-localization';
import React, { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../api/client';
import type { Trip, TripLimits, VisitorTrip } from '../api/types';
import { tr } from '../i18n/travel';
import { color, radius, space, type } from '../theme/tokens';

// F-20 travel plans (#188): API, date maths, the sky Visiting label and the Look-around state.

const locale = getLocales()[0]?.languageTag ?? 'en';

// ------------------------------------------------------------------ API

export const loadTrips = () => api<{ trips: Trip[]; limits: TripLimits }>('GET', '/trips');
export type TripInput = { city_id: number; first_day: string; last_day: string; show_days: number | null; say_from: boolean; safe_mode_ack?: boolean };
const tz = () => -new Date().getTimezoneOffset();
export const createTrip = (t: TripInput) => api<Trip>('POST', '/trips', { ...t, tz_offset_min: tz() });
export const updateTrip = (id: string, t: Partial<TripInput>) => api<Trip>('PATCH', `/trips/${id}`, { ...t, tz_offset_min: tz() });
export const deleteTrip = (id: string) => api('DELETE', `/trips/${id}`);

// ------------------------------------------------------------------ dates (local calendar days)

/** "2026-12-03" → local Date at noon (no DST edge). */
export const parseDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12);
};
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
/** Whole days from `a` to `b`. */
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
export const daysUntil = (s: string) => daysBetween(today(), parseDay(s));

const dm = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const d = new Intl.DateTimeFormat(locale, { day: 'numeric' });
const wdm = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

/** "3–7 Dec" (same month) or "30 Nov – 2 Dec". */
export function rangeLabel(first: string, last: string): string {
  const a = parseDay(first);
  const b = parseDay(last);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${d.format(a)}–${dm.format(b)}`;
  return `${dm.format(a)} – ${dm.format(b)}`;
}
/** "Wed 3 Dec – Sun 7 Dec" for the trip card. */
export const longRange = (first: string, last: string) => `${wdm.format(parseDay(first))} – ${wdm.format(parseDay(last))}`;
export const dayLabel = (s: string) => dm.format(parseDay(s));
export const weekdayLabel = (s: string) => wdm.format(parseDay(s));

/** R-20.6 short label: before arrival "Arriving in 12 days"; during "Visiting". */
export function shortLabel(t: VisitorTrip): string {
  if (t.here || daysUntil(t.first_day) <= 0) return t.here ? tr.hereNow : tr.visiting;
  return tr.arrivingIn(daysUntil(t.first_day));
}
/** R-20.6 tile tag: "In 12 d" / "Tomorrow" / "Today" / "Here now". */
export const tileTag = (t: VisitorTrip) => (t.here ? tr.hereNow : tr.inDays(daysUntil(t.first_day)));
/** R-20.6 long label: "Visiting Berlin · 3–7 Dec" before, "Visiting · until Sun 7 Dec" during. */
export function longLabel(t: VisitorTrip): string {
  if (daysUntil(t.first_day) <= 0) return tr.visitingUntil(weekdayLabel(t.last_day));
  return tr.visitingCity(t.city, rangeLabel(t.first_day, t.last_day), t.from);
}
export const a11yLabel = (t: VisitorTrip) => tr.a11y(t.city, rangeLabel(t.first_day, t.last_day), shortLabel(t));

// ------------------------------------------------------------------ UI

export function Plane({ size = 12, c = color.onAccent }: { size?: number; c?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={c} d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z" />
    </Svg>
  );
}

/** R-20.6 sky pill: plane + text, never colour alone. */
export function TravelLabel({ text, small, outline, a11y }: { text: string; small?: boolean; outline?: boolean; a11y?: string }) {
  return (
    <View
      accessible
      accessibilityLabel={a11y ?? text}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        paddingLeft: small ? 5 : 6,
        paddingRight: small ? 7 : 9,
        paddingVertical: small ? 2 : 3,
        borderRadius: radius.pill,
        backgroundColor: outline ? 'transparent' : color.travel,
        borderWidth: outline ? 1.5 : 0,
        borderColor: color.travel,
      }}
    >
      <Plane size={small ? 10 : 12} c={outline ? color.travel : color.onAccent} />
      <Text numberOfLines={1} style={{ ...type.caption, fontSize: small ? 9.5 : 11, color: outline ? color.travel : color.onAccent }}>
        {text}
      </Text>
    </View>
  );
}

/** R-20.7 reason card on a visitor's profile. */
export function TravelReason({ trip }: { trip: VisitorTrip }) {
  const before = !trip.here && daysUntil(trip.first_day) > 0;
  const title = before ? tr.visitingCity(trip.city, rangeLabel(trip.first_day, trip.last_day), trip.from) : tr.visitingUntil(weekdayLabel(trip.last_day));
  const sub = before ? `${tr.arrivingIn(daysUntil(trip.first_day))} · ${tr.notYet(trip.city)}` : trip.here ? tr.hereNow : tr.until(weekdayLabel(trip.last_day));
  return (
    <View
      testID="travel-reason"
      accessible
      accessibilityLabel={`${title}. ${sub}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: 18, backgroundColor: color.travelSoft, borderWidth: 1.5, borderColor: color.travel }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: color.travel, alignItems: 'center', justifyContent: 'center' }}>
        <Plane size={18} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{title}</Text>
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{sub}</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ Look around (R-20.14), per session

type Look = Trip | null;
let look: Look = null;
const subs = new Set<() => void>();
export function setLookAround(t: Look) {
  look = t;
  subs.forEach((f) => f());
}
export const lookAround = () => look;
export function useLookAround(): Look {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => look,
  );
}

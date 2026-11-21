import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Trip, TripLimits } from '../api/types';
import { useSession } from '../app/session';
import { tr } from '../i18n/travel';
import { color, radius, space, type } from '../theme/tokens';
import { ErrorState, Icon, Loading } from '../ui';
import { tx } from '../i18n/app';
import { dayLabel, daysUntil, loadTrips, longRange, Plane, setLookAround } from './travel';
import { TripSheet } from './TripSheet';

type Nav = { navigate: (s: string, p?: object) => void };

// S-72 Trips (F-20 R-20.1).
export function TripsScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const [data, setData] = useState<{ trips: Trip[]; limits: TripLimits } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Trip | 'new' | null>(null);

  const load = useCallback(() => {
    loadTrips().then(
      (r) => {
        setErr(null);
        setData(r);
      },
      () => setErr(tx.common.error),
    );
  }, []);
  useFocusEffect(load);

  if (err && !data) return <ErrorState text={err} retry={tx.common.retry} onRetry={load} />;
  if (!data) return <Loading />;

  const left = Math.max(0, data.limits.max - data.trips.length);
  const look = (t: Trip) => {
    setLookAround(t);
    navigation.navigate('Tabs', { screen: 'Explore' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.m, paddingBottom: 140 }}>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, color: color.fgPrimary }}>
          {tr.trips}
        </Text>
        {data.trips.length === 0 ? (
          <View testID="trips-empty" style={{ alignItems: 'center', gap: space.m, paddingVertical: space.huge }}>
            <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: color.travelSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Plane size={30} c={color.travel} />
            </View>
            <Text style={{ ...type.title, color: color.fgPrimary }}>{tr.emptyTitle}</Text>
            <Text style={{ ...type.body, color: color.fgSecondary, textAlign: 'center', maxWidth: 300 }}>{tr.emptyBody}</Text>
            <Pressable
              testID="trip-add"
              accessibilityRole="button"
              onPress={() => setEdit('new')}
              style={({ pressed }) => ({ height: 48, paddingHorizontal: space.xxl, borderRadius: radius.pill, backgroundColor: color.travel, justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ ...type.headline, color: color.onAccent }}>{tr.add}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {data.trips.map((t) => (
              <TripCard key={t.id} t={t} verified={me.verified} onLook={() => look(t)} onEdit={() => setEdit(t)} />
            ))}
            {left > 0 ? (
              <Pressable
                testID="trip-add"
                accessibilityRole="button"
                onPress={() => setEdit('new')}
                style={({ pressed }) => ({ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.line, borderRadius: radius.md, padding: space.l, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}
              >
                <Text style={{ ...type.headline, fontSize: 14, color: color.fgSecondary }}>
                  ＋ {tr.add} <Text style={{ fontFamily: type.meta.fontFamily, color: color.fgMuted }}>· {tr.addLeft(left)}</Text>
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <Icon.Pin size={14} c={color.trust} />
          <Text style={{ ...type.meta, fontSize: 12, color: color.trust, flex: 1 }}>{tr.footer}</Text>
        </View>
      </ScrollView>
      <TripSheet
        trip={edit === 'new' ? null : edit}
        visible={edit !== null}
        verified={me.verified}
        home={null}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          load();
        }}
      />
    </View>
  );
}

function countdown(t: Trip): { big: string; small: string } {
  const n = daysUntil(t.first_day);
  if (n <= 0) return { big: '', small: tr.hereNow };
  if (n === 1) return { big: '', small: tr.tomorrow };
  return { big: String(n), small: tr.days(n) };
}

function TripCard({ t, verified, onLook, onEdit }: { t: Trip; verified: boolean; onLook: () => void; onEdit: () => void }) {
  const cd = countdown(t);
  const shownNow = t.shown_from && daysUntil(t.shown_from) <= 0;
  const vis =
    t.show_days === null ? (verified ? tr.onlyYou : tr.verifyToShow) : shownNow ? tr.shownNow(t.city.name) : tr.shownFrom(t.city.name, dayLabel(t.shown_from!));
  const shown = t.show_days !== null;
  return (
    <View testID={`trip-${t.id}`} style={{ backgroundColor: color.bgRaised, borderRadius: radius.md, padding: space.m, gap: space.s + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: color.travelSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Plane size={22} c={color.travel} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ ...type.title, fontSize: 19, lineHeight: 24, color: color.fgPrimary }}>
            {t.city.name}
          </Text>
          <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{longRange(t.first_day, t.last_day)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {cd.big ? <Text style={{ ...type.title, fontSize: 22, color: color.travel, fontVariant: ['tabular-nums'] }}>{cd.big}</Text> : null}
          <Text style={{ ...type.caption, color: cd.big ? color.fgSecondary : color.travel }}>{cd.small}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, paddingHorizontal: space.m, borderRadius: 14, backgroundColor: color.bgBase }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: shown ? color.travel : color.fgMuted }} />
        <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, fontFamily: type.headline.fontFamily, color: color.fgPrimary, flex: 1 }}>
          {vis}
        </Text>
      </View>
      {t.safe_mode_country ? (
        <Text style={{ ...type.meta, fontSize: 12, color: color.trust }}>{tr.safetyTips}</Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Pressable
          testID={`trip-look-${t.id}`}
          accessibilityRole="button"
          onPress={onLook}
          style={({ pressed }) => ({ flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: color.travel, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ ...type.headline, fontSize: 14, color: color.onAccent }}>{tr.lookAround}</Text>
        </Pressable>
        <Pressable
          testID={`trip-edit-${t.id}`}
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => ({ flex: 1, height: 40, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{tr.edit}</Text>
        </Pressable>
      </View>
    </View>
  );
}

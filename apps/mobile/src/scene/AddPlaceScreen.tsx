import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { ap } from '../i18n/addplace';
import { tx } from '../i18n/app';
import { PinMap } from '../explore/PinMap';
import { precisePosition } from '../explore/location';
import { color, space, type } from '../theme/tokens';
import { Banner, Button, Chip, Chips, ErrorText, Field } from '../ui';
import { canAdd, Fix, MAX_ACCURACY_M, PLACE_KINDS as KINDS } from './addPlace';
import type { Here, Venue } from './types';

type Nav = {
  navigate: (s: string, p?: object) => void;
  replace: (s: string, p?: object) => void;
  goBack: () => void;
};

// #191 S-17a Add a place (F-12 R-12.11): pinned at the member's exact position, live for
// everyone at once, then checked in. The coral card is the consent to share that position.
export function AddPlaceScreen({ navigation }: { navigation: Nav }) {
  const { me, mode } = useSession();
  const insets = useSafeAreaInsets();
  const [fix, setFix] = useState<Fix | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string | null>(mode === 'sport' ? 'gym' : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [existing, setExisting] = useState<{
    id: string;
    name: string;
    kind: string;
  } | null>(null);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;

  const locate = useCallback(() => {
    setFix(undefined);
    precisePosition().then(setFix, () => setFix(null));
  }, []);
  useEffect(() => {
    let live = true;
    precisePosition().then(
      (p) => live && setFix(p),
      () => live && setFix(null),
    );
    return () => {
      live = false;
    };
  }, []);

  const open = (v: { id: string; name: string; kind: string }, member: boolean) => {
    const venue: Venue = {
      id: v.id,
      name: v.name,
      kind: v.kind,
      geofence_radius_m: 80,
      here: '0',
      area_cell: '',
      distance: null,
      member,
    };
    navigation.replace('Venue', { venue });
  };

  const submit = async () => {
    if (!fix || !kind) return;
    setBusy(true);
    setErr(null);
    setExisting(null);
    try {
      const here = await api<Here>('POST', `/venues?mode=${mode}`, {
        name: name.trim(),
        kind,
        lat: fix.lat,
        lng: fix.lng,
        visible: true,
      });
      open(here.venue, true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'place_exists' && e.extra?.existing) setExisting(e.extra.existing as { id: string; name: string; kind: string });
      else setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}>
        <View
          style={{
            height: 250,
            backgroundColor: color.bgRaised,
            overflow: 'hidden',
          }}
        >
          {fix ? <PinMap lat={fix.lat} lng={fix.lng} accuracy={fix.accuracy} /> : null}
          {fix === undefined ? <ActivityIndicator style={{ position: 'absolute', alignSelf: 'center', top: 110 }} color={color.fgSecondary} /> : null}
          <Pressable
            testID="addplace-close"
            accessibilityRole="button"
            accessibilityLabel={tx.common.close}
            onPress={() => navigation.goBack()}
            style={{
              position: 'absolute',
              left: space.l,
              top: insets.top + 8,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: `${color.bgBase}D9`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path d="M6 6l12 12M18 6L6 18" stroke={color.fgPrimary} strokeWidth={2.6} strokeLinecap="round" />
            </Svg>
          </Pressable>
          <View
            style={{
              position: 'absolute',
              right: space.l,
              bottom: 14,
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              backgroundColor: `${color.bgBase}D9`,
            }}
          >
            <Text testID="addplace-accuracy" style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>
              {fix ? ap.accuracy(fix.accuracy) : ap.locating}
            </Text>
          </View>
        </View>

        <View style={{ padding: space.l, gap: space.l }}>
          <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
            {ap.title}
          </Text>

          {safe ? (
            <Banner tone="warn" text={tx.venue.safe} />
          ) : !me.verified ? (
            <Banner tone="trust" text={tx.common.verifyToDo} onPress={() => navigation.navigate('Verify')} />
          ) : (
            <>
              {fix === null ? <Banner tone="warn" text={ap.noLocation} onPress={locate} /> : null}
              {fix && fix.accuracy > MAX_ACCURACY_M ? <Banner tone="warn" text={ap.weak} onPress={locate} /> : null}
              <Field testID="addplace-name" label={ap.name} placeholder={ap.namePh} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
              <View style={{ gap: space.s }}>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{ap.what}</Text>
                <Chips>
                  {KINDS.map((k) => (
                    <Chip key={k} label={ap.kinds[k]} on={kind === k} onPress={() => setKind(k)} fill={color.fgPrimary} />
                  ))}
                </Chips>
              </View>

              <View
                testID="addplace-warning"
                accessible
                accessibilityRole="alert"
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  padding: 14,
                  borderRadius: 18,
                  backgroundColor: color.alertBg,
                  borderWidth: 1.5,
                  borderColor: color.hookup,
                }}
              >
                <Svg width={22} height={22} viewBox="0 0 24 24" style={{ marginTop: 1 }}>
                  <Path d="M12 3l10 18H2z" fill="none" stroke={color.alertIcon} strokeWidth={2.2} strokeLinejoin="round" />
                  <Path d="M12 10v5M12 18v.5" stroke={color.alertIcon} strokeWidth={2.4} strokeLinecap="round" />
                </Svg>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    style={{
                      ...type.headline,
                      fontSize: 15,
                      color: color.alertTitle,
                    }}
                  >
                    {ap.warnTitle}
                  </Text>
                  <Text
                    style={{
                      ...type.meta,
                      lineHeight: 18,
                      color: color.alertBody,
                    }}
                  >
                    {ap.warnBody}
                  </Text>
                </View>
              </View>

              {existing ? (
                <View
                  testID="addplace-exists"
                  style={{
                    gap: space.s,
                    padding: 14,
                    borderRadius: 18,
                    backgroundColor: color.bgRaised,
                  }}
                >
                  <Text style={{ ...type.body, color: color.fgPrimary }}>{ap.exists(existing.name)}</Text>
                  <Button testID="addplace-existing" title={ap.checkInThere} kind="trust" small onPress={() => open(existing, false)} />
                </View>
              ) : null}
              <ErrorText text={err} />
            </>
          )}
        </View>
      </ScrollView>

      {!safe && me.verified ? (
        <View
          style={{
            position: 'absolute',
            left: space.l,
            right: space.l,
            bottom: insets.bottom + 12,
            gap: 10,
          }}
        >
          <Button testID="addplace-submit" title={ap.add} fill={color.hookup} busy={busy} disabled={!canAdd(name, kind, fix ?? null)} onPress={submit} />
          <Text
            style={{
              ...type.meta,
              fontSize: 12,
              textAlign: 'center',
              color: color.fgMuted,
            }}
          >
            {ap.review}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

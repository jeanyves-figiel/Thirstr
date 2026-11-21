import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { distanceLabel, tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Banner, Button, ErrorText, Field, Hero, Icon, ListRow, Loading, Section, Toggle } from '../ui';
import { ap } from '../i18n/addplace';
import { Who } from './TonightScreen';
import { usePull } from '../ui/pull';
import type { Here, Venue } from './types';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void };

// S-17 Venue (F-12): check in (visible toggle, optional zone), see who is here, check out.
export function VenueScreen({ navigation, route }: { navigation: Nav; route: { params: { venue: Venue } } }) {
  const v = route.params.venue;
  const { me, mode } = useSession();
  const [here, setHere] = useState<Here | null | undefined>(undefined);
  const [visible, setVisible] = useState(true);
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;

  const load = useCallback(
    () =>
      api<Here>('GET', `/venues/${v.id}/here`).then(
        (h) => {
          setHere(h);
          setVisible(h.me.visible);
        },
        (e) => setHere(e instanceof ApiError && e.status === 403 ? null : (setErr(tx.common.error), null)),
      ),
    [v.id],
  );
  useEffect(() => {
    load();
  }, [load]);
  const refresh = usePull(load); // F-19 G6

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  // R-12.11: the creator removes their place while nobody else is checked in.
  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('DELETE', `/venues/${v.id}`);
      navigation.goBack();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
      setBusy(false);
    }
  };

  if (here === undefined) return <Loading />;

  return (
    <ScrollView showsVerticalScrollIndicator={false}
      refreshControl={refresh}
      style={{ flex: 1, backgroundColor: color.bgBase }}
      contentContainerStyle={{
        padding: space.l,
        gap: space.l,
        paddingBottom: 120,
      }}
    >
      <Hero fill={color.trust} pill={[tx.venue.kinds[v.kind] ?? v.kind, (here?.venue.member ?? v.member) ? ap.member : null].filter(Boolean).join(' · ')} title={v.name} meta={here ? undefined : [distanceLabel(v.distance), tx.venue.here(v.here)].filter(Boolean).join(' · ')} />
      <ErrorText text={err} />

      {here ? (
        <>
          <Text testID="venue-stats" style={{ ...type.headline, color: color.trust }}>
            {tx.venue.stats(here.stats.total, here.stats.visible_to_you, here.stats.tapped_you)}
          </Text>
          <Section>
            <Toggle label={tx.venue.visible} value={visible} tone={color.trust} onChange={(x) => call(() => api('PATCH', `/venues/${v.id}/checkin`, { visible: x }))} />
          </Section>
          {!here.me.visible ? <Banner tone="warn" text={tx.venue.hidden} /> : null}
          {here.me.visible && here.people.length === 0 ? <Text style={{ ...type.meta, color: color.fgMuted }}>{tx.venue.empty}</Text> : null}
          {here.people.length ? (
            <Section>
              {here.people.map((x) => (
                <View key={x.profile.id} style={{ paddingVertical: space.m }}>
                  <Who p={x.profile} sub={[x.zone, x.tapped_me ? tx.profile.tappedYou : null].filter(Boolean).join(' · ') || undefined} onPress={() => navigation.navigate('Profile', { id: x.profile.id })} right={<Icon.Next />} />
                </View>
              ))}
            </Section>
          ) : null}
          <Section>
            <ListRow testID="venue-checkout" title={tx.venue.checkout} danger onPress={() => call(() => api('POST', '/venues/checkout'))} />
          </Section>
          {here.venue.removable ? (
            <Section>
              <ListRow testID="venue-remove" title={ap.remove} sub={ap.removeSub} danger onPress={remove} />
            </Section>
          ) : null}
        </>
      ) : (
        <>
          {safe ? (
            <Banner tone="warn" text={tx.venue.safe} />
          ) : !me.verified ? (
            <Banner tone="trust" text={tx.common.verifyToDo} onPress={() => navigation.navigate('Verify')} />
          ) : (
            <>
              <Section>
                <Toggle label={tx.venue.visible} value={visible} tone={color.trust} onChange={setVisible} />
              </Section>
              <Field testID="venue-zone" label={tx.venue.zone} value={zone} onChangeText={setZone} maxLength={40} />
              <Button
                testID="venue-checkin"
                title={tx.venue.checkin}
                kind="trust"
                busy={busy}
                onPress={() =>
                  call(() =>
                    api('POST', `/venues/${v.id}/checkin?mode=${mode}`, {
                      visible,
                      zone: zone.trim() || null,
                    }),
                  )
                }
              />
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

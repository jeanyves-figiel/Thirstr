import { privateStore as AsyncStorage } from '../app/privateStore';
import * as ExpoLocation from 'expo-location';
import { getLocales } from 'expo-localization';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Text } from 'react-native';
import { api, Me } from '../api/client';
import { useSession } from '../app/session';
import { currentPosition } from '../explore/location';
import { areaCell } from '../geo/cells';
import { tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Button, ListRow, Sheet } from '../ui';
import { isSafeModeCountry, refreshSafeModeList } from './criminalizing';

const PREV = 'thirstr.safe.prevLevel';

/** Country on the device only: OS reverse geocoder, else the device region (R-14.1, R-14.3). */
async function country(): Promise<string | null> {
  const p = await currentPosition().catch(() => null);
  if (p && Platform.OS !== 'web') {
    const r = await ExpoLocation.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng }).catch(() => []);
    if (r[0]?.isoCountryCode) return r[0].isoCountryCode.toUpperCase();
  }
  return getLocales()[0]?.regionCode?.toUpperCase() ?? null;
}

export function Resources() {
  return (
    <>
      <Text style={{ ...type.meta, color: color.fgSecondary, paddingVertical: space.m }}>{tx.safeMode.resourcesBody}</Text>
      {tx.safeMode.orgs.map(([name, url]) => (
        <ListRow key={name} title={name} sub={url.replace('https://', '')} onPress={() => Linking.openURL(url)} />
      ))}
    </>
  );
}

// F-14 Auto: turn Safe Mode on/off with the country; on activation offer app lock + duress PIN
// and resources; on leaving, offer to restore the previous location level (R-14.4).
export function SafeModeAuto({ navigate }: { navigate: (s: string) => void }) {
  const { me, setMe } = useSession();
  const [sheet, setSheet] = useState<null | 'on' | 'left'>(null);

  const check = useCallback(async () => {
    if (me.safe_mode !== 'auto') return;
    await refreshSafeModeList();
    const c = await country();
    if (!c) return;
    const active = isSafeModeCountry(c);
    if (active === !!me.safe_mode_active) return;
    if (active && me.location?.level) await AsyncStorage.setItem(PREV, me.location.level).catch(() => {});
    const next = await api<Me>('PUT', '/me/safe_mode', { setting: 'auto', active }).catch(() => null);
    if (!next) return;
    setMe(next);
    setSheet(active ? 'on' : (await AsyncStorage.getItem(PREV).catch(() => null)) ? 'left' : null);
  }, [me, setMe]);

  useEffect(() => {
    const t0 = setTimeout(check, 1500);
    const s = AppState.addEventListener('change', (st) => st === 'active' && check());
    const t = setInterval(check, 30 * 60_000);
    return () => {
      clearTimeout(t0);
      s.remove();
      clearInterval(t);
    };
  }, [check]);

  const restore = async () => {
    const prev = await AsyncStorage.getItem(PREV).catch(() => null);
    const p = await currentPosition().catch(() => null);
    if (prev && p && ['area', 'city', 'hidden'].includes(prev)) {
      const m = await api<Me>('PUT', '/me/location', { level: prev, cell_r9: areaCell(p.lat, p.lng) }).catch(() => null);
      if (m) setMe(m);
    }
    await AsyncStorage.removeItem(PREV).catch(() => {});
    setSheet(null);
  };

  return (
    <>
      <Sheet visible={sheet === 'on'} onClose={() => setSheet(null)} title={tx.safeMode.onTitle} closeLabel={tx.common.close}>
        <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.safeMode.onBody}</Text>
        <Button
          testID="safe-setlock"
          kind="trust"
          title={tx.safeMode.setLock}
          onPress={() => {
            setSheet(null);
            navigate('AppLock');
          }}
        />
        <Text style={{ ...type.headline, color: color.fgPrimary, marginTop: space.s }}>{tx.safeMode.resources}</Text>
        <Resources />
        <Button kind="ghost" title={tx.safeMode.later} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === 'left'} onClose={() => setSheet(null)} title={tx.safeMode.leftTitle} closeLabel={tx.common.close}>
        <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.safeMode.leftBody}</Text>
        <Button kind="trust" title={tx.safeMode.restore} onPress={restore} />
        <Button kind="ghost" title={tx.safeMode.keep} onPress={() => AsyncStorage.removeItem(PREV).finally(() => setSheet(null))} />
      </Sheet>
    </>
  );
}

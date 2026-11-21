import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiError, type Me } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { v3 } from '../i18n/v3';
import { HiddenPanel } from '../me/HiddenPanel';
import { color, font, radius, space, type } from '../theme/tokens';
import { Banner, Button, Chip, Chips, ErrorText, Field, Icon, Toggle } from '../ui';
import { type Level, position, quickLevel } from './level';

type City = { id: number; name: string; country: string };
export const LEVELS: Level[] = ['hidden', 'city', 'area', 'exact'];
export const TTLS = [1800, 3600, 7200, 14400];
export const AUDIENCES = ['verified', 'chats', 'everyone'];
export const ttlLabel = (t: number) => (t < 3600 ? '30 min' : `${t / 3600} h`);
const cap = { ...type.caption, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' as const, color: color.fgMuted };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * #190 (S-60, S-30, R-05.4): the one location control, used inline on Me and inside the
 * location sheet (Explore, Settings › Privacy). Every tap applies; there is no Save.
 * Hidden / City / Area switch at once. Exact opens its panel under the switch; others keep
 * seeing the current level until "Share my pin" (the explicit confirm). While a pin is live,
 * time and audience changes re-set it right away; Stop pin goes back to Area (server).
 */
export function LocationControl({ onLocked, testPrefix = 'me' }: { onLocked?: () => void; testPrefix?: string }) {
  const { me, setMe } = useSession();
  const level = (me.location?.level ?? 'city') as Level;
  const pin = me.location?.pin ?? null;
  const [pendingExact, setPendingExact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cities, setCities] = useState<City[] | null>(null);
  const [cityQ, setCityQ] = useState('');
  const shown: Level = level === 'exact' || pendingExact ? 'exact' : level;
  const safeOn = me.safe_mode === 'on' || !!me.safe_mode_active;

  const run = async (fn: () => Promise<Me | null>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      if (r) setMe(r);
      return r;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const pick = (l: Level) => {
    if (busy) return;
    if ((l === 'hidden' || l === 'exact') && !me.verified) return onLocked?.();
    setCities(null);
    if (l === 'exact') return setPendingExact(true);
    setPendingExact(false);
    if (l === level) return;
    run(async () => {
      const r = await quickLevel(l, l === 'hidden' ? { until: null, return_level: level === 'city' ? 'city' : 'area' } : undefined, l === 'area' ? !!me.location?.precise : undefined);
      if (r) return r;
      // No position: City falls back to a city search, the others need permission.
      if (l === 'city') setCities([]);
      else setErr(tx.location.permission);
      return null;
    });
  };

  async function searchCity(v: string) {
    setCityQ(v);
    if (v.trim().length < 2) return setCities([]);
    const r = await api<{ cities: City[] }>('GET', '/cities?q=' + encodeURIComponent(v.trim())).catch(() => null);
    if (r) setCities(r.cities);
  }

  return (
    <View style={{ gap: space.m }}>
      <View
        testID={`${testPrefix}-location`}
        accessibilityRole="radiogroup"
        accessibilityLabel={tx.me.location}
        style={{ flexDirection: 'row', padding: 4, gap: 2, borderRadius: radius.pill, backgroundColor: color.bgBase }}
      >
        {LEVELS.map((l) => {
          const on = l === shown;
          const locked = (l === 'hidden' || l === 'exact') && !me.verified;
          const live = l === 'exact' && !!pin;
          return (
            <Pressable
              key={l}
              testID={`${testPrefix}-level-${l}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: busy }}
              accessibilityLabel={tx.location.levels[l][0]}
              onPress={() => pick(l)}
              style={{ flexGrow: 1, flexShrink: 1, flexBasis: 'auto', paddingHorizontal: 6, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: on ? color.trust : 'transparent', opacity: locked ? 0.5 : 1 }}
            >
              {locked ? <Icon.Lock size={11} c={color.fgSecondary} /> : null}
              <Text numberOfLines={1} style={{ ...type.meta, fontFamily: font.bold, fontSize: 14, color: on ? color.onAccent : color.fgSecondary }}>
                {tx.location.levels[l][0]}
              </Text>
              {live ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.hookup }} /> : null}
            </Pressable>
          );
        })}
      </View>
      {!me.verified ? <Text style={{ ...type.meta, color: color.fgMuted }}>{v3.me.verifyLocked}</Text> : null}
      {shown === 'hidden' ? <HiddenPanel me={me} setMe={setMe} /> : null}
      {shown === 'area' && !safeOn ? (
        // #197 R-05.13: closer distance (~50 m) on Area, applies on tap.
        <View testID={`${testPrefix}-closer-panel`} style={{ borderWidth: 1.5, borderColor: color.trust, borderRadius: radius.sm + 6, paddingHorizontal: space.m, paddingVertical: space.s, backgroundColor: color.bgBase }}>
          <Toggle
            label={tx.location.closer.label}
            sub={me.location?.precise ? tx.location.closer.on : tx.location.closer.off}
            value={!!me.location?.precise}
            disabled={busy}
            tone={color.trust}
            onChange={(v) =>
              run(async () => {
                const r = await quickLevel('area', undefined, v);
                if (!r) setErr(tx.location.permission);
                return r;
              })
            }
          />
        </View>
      ) : null}
      {shown === 'exact' ? <ExactPanel testPrefix={testPrefix} level={level} onStop={() => setPendingExact(false)} onShared={() => setPendingExact(false)} /> : null}
      {cities ? (
        <View style={{ gap: space.s }}>
          <Field label={v3.me.exact.citySearch} placeholder="Zürich" value={cityQ} onChangeText={searchCity} />
          {cities.map((c) => (
            <Button
              key={c.id}
              kind="secondary"
              small
              title={`${c.name}, ${c.country}`}
              busy={busy}
              onPress={async () => {
                if (await run(() => api<Me>('PUT', '/me/location', { level: 'city', city_id: c.id }))) setCities(null);
              }}
            />
          ))}
        </View>
      ) : null}
      <ErrorText text={err} />
    </View>
  );
}

function ExactPanel({ level, onShared, onStop, testPrefix }: { level: Level; onShared: () => void; onStop: () => void; testPrefix: string }) {
  const { me, setMe } = useSession();
  const E = v3.me.exact;
  const pin = me.location?.pin ?? null;
  const [ttl, setTtl] = useState(3600);
  const [audience, setAudience] = useState(pin?.audience ?? 'verified');
  const [safeWarn, setSafeWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const safeOn = me.safe_mode === 'on' || !!me.safe_mode_active;

  // R-05.4: one explicit tap shares; a live pin is re-set (new jitter, TTL from now) on each change.
  const share = async (t: number, a: string, override: boolean) => {
    if (safeOn && !override) return setSafeWarn(true);
    setSafeWarn(false);
    setBusy(true);
    setErr(null);
    try {
      const p = await position();
      if (!p) return setErr(tx.location.permission);
      setMe(await api<Me>('PUT', '/me/pin', { lat: p.lat, lng: p.lng, ttl_s: t, audience: a, confirm: true, safe_mode_override: safeOn || undefined }));
      onShared();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setErr(null);
    try {
      setMe(await api<Me>('DELETE', '/me/pin'));
      onStop();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const pickTtl = (t: number) => {
    setTtl(t);
    if (pin) share(t, audience, true);
  };
  const pickAudience = (a: string) => {
    setAudience(a);
    if (pin) share(ttl, a, true);
  };

  const stayOn = tx.location.levels[level === 'exact' ? 'area' : level][0];

  return (
    <View testID={`${testPrefix}-exact-panel`} style={{ borderWidth: 1.5, borderColor: color.trust, borderRadius: radius.sm + 6, padding: space.m, gap: space.m, backgroundColor: color.bgBase }}>
      {pin ? (
        <View testID={`${testPrefix}-pin-live`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: `${color.hookup}24` }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.hookup }} />
          <Text style={{ flex: 1, ...type.meta, fontFamily: font.bold, color: color.fgPrimary }}>{E.live(hhmm(pin.expires_at), tx.location.audiences[pin.audience] ?? pin.audience)}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Icon.Pin size={20} c={color.trust} />
          <Text style={{ flex: 1, ...type.meta, color: color.fgSoft }}>{level === 'exact' ? E.ended : E.explain}</Text>
        </View>
      )}
      <View style={{ gap: 6 }}>
        <Text style={cap}>{tx.location.ttl}</Text>
        <Chips>
          {TTLS.map((t) => (
            <Chip key={t} label={ttlLabel(t)} on={ttl === t} disabled={busy} fill={color.trust} onPress={() => pickTtl(t)} />
          ))}
        </Chips>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={cap}>{tx.location.audience}</Text>
        <Chips>
          {AUDIENCES.map((a) => (
            <Chip key={a} label={tx.location.audiences[a]} on={audience === a} disabled={busy} fill={color.trust} onPress={() => pickAudience(a)} />
          ))}
        </Chips>
      </View>
      {safeWarn ? (
        <View style={{ gap: space.s }}>
          <Banner tone="danger" text={E.safeWarn} />
          <Button testID={`${testPrefix}-pin-anyway`} kind="danger" small title={E.shareAnyway} busy={busy} onPress={() => share(ttl, audience, true)} />
        </View>
      ) : pin ? (
        <Button testID={`${testPrefix}-pin-stop`} kind="secondary" small title={E.stop} busy={busy} onPress={stop} />
      ) : (
        <Button testID={`${testPrefix}-pin-share`} kind="trust" small title={E.share(ttlLabel(ttl))} busy={busy} onPress={() => share(ttl, audience, false)} />
      )}
      {!pin && level !== 'exact' ? <Text style={{ ...type.meta, color: color.fgMuted }}>{E.notYet(stayOn)}</Text> : null}
      <ErrorText text={err} />
    </View>
  );
}

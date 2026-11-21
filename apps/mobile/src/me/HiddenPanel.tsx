import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, type Me } from '../api/client';
import { quickLevel } from '../explore/level';
import { tx } from '../i18n/app';
import { v3 } from '../i18n/v3';
import { color, radius, space, type } from '../theme/tokens';
import { Chip, Chips, ErrorText, Icon } from '../ui';
import { type Back, backOf, STAYS, type Stay, stayOf, untilFor } from './hidden';

const cap = { ...type.caption, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' as const, color: color.fgMuted };

// #114 F-05 R-05.7 (S-60): shown under the level segment while Hidden. Replaces Incognito.
export function HiddenPanel({ me, setMe }: { me: Me; setMe: (m: Me) => void }) {
  const H = v3.me.hidden;
  const [stay, setStay] = useState<Stay>(() => stayOf(me));
  const [back, setBack] = useState<Back>(() => backOf(me));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apply = async (s: Stay, b: Back) => {
    setStay(s);
    setBack(b);
    setBusy(true);
    setErr(null);
    try {
      const r = await quickLevel('hidden', { until: untilFor(s), return_level: b });
      if (r) setMe(r);
      else setErr(tx.common.error);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const at = me.hidden_until ? new Date(me.hidden_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const backName = tx.location.levels[back][0];

  return (
    <View testID="me-hidden-panel" style={{ borderWidth: 1.5, borderColor: color.trust, borderRadius: radius.sm + 6, padding: space.m, gap: space.m, backgroundColor: color.bgBase }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Icon.EyeOff size={20} c={color.trust} />
        <Text style={{ flex: 1, ...type.meta, color: color.fgSoft }}>{H.explain}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={cap}>{H.stay}</Text>
        <Chips>
          {STAYS.map((s) => (
            <Chip key={s} label={H.stays[s]} on={stay === s} disabled={busy} fill={color.trust} onPress={() => apply(s, back)} />
          ))}
        </Chips>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={cap}>{H.back}</Text>
        <Chips>
          {(['city', 'area'] as const).map((b) => (
            <Chip key={b} label={tx.location.levels[b][0]} on={back === b} disabled={busy} fill={color.trust} onPress={() => apply(stay, b)} />
          ))}
        </Chips>
      </View>
      <Text testID="me-hidden-foot" style={{ ...type.meta, color: color.fgMuted }}>
        {stay === 'manual' || !at ? H.footManual(backName) : H.footTimed(backName, at)}
      </Text>
      <ErrorText text={err} />
    </View>
  );
}

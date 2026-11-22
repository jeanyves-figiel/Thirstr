import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSession } from '../app/session';
import { plx } from '../i18n/plus';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon } from '../ui/icons';
import { cardHidden, hideCard, isPlus, promptsAllowed, type PlusLimitHit } from './plus';

// F-23 (#318): `plus` mark = coral → violet gradient tile with an ink "+" (design-system token
// `plus`). Used on the Plus screen, limit cards and the small "+" tag (R-23.17), never as a lock.

export function PlusMark({ size = 34, r }: { size?: number; r?: number }) {
  const rad = r ?? Math.round(size * 0.32);
  const id = `plus-g-${size}`;
  const arm = size * 0.27;
  const c = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color.hookup} />
          <Stop offset="1" stopColor={color.friends} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={size} height={size} rx={rad} fill={`url(#${id})`} />
      <Path d={`M${c - arm} ${c}H${c + arm}M${c} ${c - arm}V${c + arm}`} stroke={color.onAccent} strokeWidth={Math.max(2, size * 0.11)} strokeLinecap="round" />
    </Svg>
  );
}

/** Small "+" tag beside a Plus-only row (R-23.17). Tap opens S-90 at that benefit. */
export function PlusTag({ size = 16 }: { size?: number }) {
  return <PlusMark size={size} r={5} />;
}

type Copy = { t: string; s: string };

function copyFor(hit: Pick<PlusLimitHit, 'limit' | 'free' | 'plus' | 'next_at'>): Copy {
  const L = plx.limit;
  const f = hit.free ?? 0;
  const p = hit.plus ?? 0;
  const when = hit.next_at ? new Date(hit.next_at) : null;
  const day = when ? when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : null;
  const time = when ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
  switch (hit.limit) {
    case 'nearby':
      return L.nearby;
    case 'party_capacity':
      return { t: L.party_capacity.t(f), s: L.party_capacity.s(p) };
    case 'party_per_week':
      return { t: L.party_per_week.t, s: L.party_per_week.s(day) };
    case 'tonight_active':
      return { t: L.tonight_active.t, s: L.tonight_active.s(p) };
    case 'trips':
      return { t: L.trips.t(f), s: L.trips.s(p) };
    case 'moments_per_day':
      return { t: L.moments_per_day.t(f), s: L.moments_per_day.s(time) };
    case 'moments_live':
      return { t: L.moments_live.t(f), s: L.moments_live.s };
    default:
      return L.generic;
  }
}

/**
 * Limit card (R-23.16): inline where the limit was reached, never a pop-up. For a Plus member at
 * Plus's own cap it shows the server's plain message and no upsell. `hideKey` enables ✕ (7 days).
 */
export function PlusLimit({ hit, hideKey, tone = color.bgRaised, testID = 'plus-limit' }: { hit: Pick<PlusLimitHit, 'limit' | 'free' | 'plus' | 'next_at'> & { message?: string }; hideKey?: string; tone?: string; testID?: string }) {
  const { me } = useSession();
  const nav = useNavigation<{ navigate: (r: string, p?: object) => void }>();
  const [hidden, setHidden] = useState(!!hideKey);
  useEffect(() => {
    if (hideKey) cardHidden(hideKey).then(setHidden);
  }, [hideKey]);
  if (hidden) return null;
  const plus = isPlus(me);
  if (plus && !hit.message) return null;
  // R-23.7: in the first 3 days the card only says what the limit is, with no Plus prompt.
  const sell = !plus && promptsAllowed(me);
  const c: Copy = plus ? { t: hit.message ?? '', s: '' } : sell ? copyFor(hit) : { t: copyFor(hit).t, s: '' };
  return (
    <View testID={testID} accessibilityRole="summary" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, padding: space.m, borderRadius: radius.md - 4, borderWidth: 1, borderColor: color.line, backgroundColor: tone }}>
      <PlusMark size={34} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: font.heavy, fontSize: 14, lineHeight: 18, color: color.fgPrimary }}>{c.t}</Text>
        {c.s ? <Text style={{ ...type.meta, fontSize: 12.5, color: color.fgSecondary }}>{c.s}</Text> : null}
        {sell ? (
          <Pressable
            testID={`${testID}-see`}
            accessibilityRole="button"
            onPress={() => nav.navigate('Plus', { from: hit.limit })}
            style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: space.s, height: 32, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.bgInverse, justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}
          >
            <Text style={{ fontFamily: font.heavy, fontSize: 13, color: color.onAccent }}>{plx.seePlus}</Text>
          </Pressable>
        ) : null}
      </View>
      {hideKey && sell ? (
        <Pressable
          testID={`${testID}-hide`}
          accessibilityRole="button"
          accessibilityLabel={plx.hide}
          hitSlop={10}
          onPress={() => {
            setHidden(true);
            hideCard(hideKey);
          }}
        >
          <Icon.Close size={16} c={color.fgMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

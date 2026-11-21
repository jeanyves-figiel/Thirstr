import React from 'react';
import { Image, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Card, Mode } from '../api/types';
import { color, font, modeColor } from '../theme/tokens';
import { INTENTS, initial, ringSegments } from './mapShared';

/**
 * F-04 R-04.19 (#113) person pin: face inside a ring split into his intents (hookup → friends →
 * sport, clockwise from 12 o'clock). Selected 60 pt, else 52 pt. Now = white dot, Exact = teal halo.
 */
export function RingPin({ card, selected }: { card: Card; selected?: boolean }) {
  const box = selected ? 60 : 52;
  const face = selected ? 40 : 36;
  const segs = ringSegments(card.intents ?? ['hookup'], 23);
  return (
    <View style={{ width: box + 6, height: box + 6, alignItems: 'center', justifyContent: 'center' }}>
      {card.exact ? <View style={{ position: 'absolute', width: box + 6, height: box + 6, borderRadius: (box + 6) / 2, borderWidth: 3, borderColor: color.trust }} /> : null}
      <Svg width={box} height={box} viewBox="0 0 52 52" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={26} cy={26} r={23} fill={color.bgBase} />
        {segs.map((s, i) => (
          <Circle key={i} cx={26} cy={26} r={23} fill="none" stroke={s.color} strokeWidth={4.5} strokeDasharray={s.dash} strokeDashoffset={s.offset} />
        ))}
      </Svg>
      <View style={{ width: face, height: face, borderRadius: face / 2, overflow: 'hidden', backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}>
        {card.photo ? <Image source={{ uri: card.photo }} style={{ width: face, height: face }} /> : <Text style={{ fontFamily: font.heavy, fontSize: 16, color: color.fgPrimary }}>{initial(card.display_name)}</Text>}
      </View>
      {card.now ? <View style={{ position: 'absolute', top: 1, right: 1, width: 14, height: 14, borderRadius: 7, backgroundColor: color.bgInverse, borderWidth: 3, borderColor: color.bgMap }} /> : null}
    </View>
  );
}

/** R-04.19: the same intents as a 4 pt bar along a grid tile's bottom edge. */
export function IntentBar({ intents }: { intents?: Mode[] }) {
  const list = INTENTS.filter((m) => (intents ?? []).includes(m));
  if (!list.length) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, flexDirection: 'row' }}>
      {list.map((m) => (
        <View key={m} style={{ flex: 1, backgroundColor: modeColor[m] }} />
      ))}
    </View>
  );
}

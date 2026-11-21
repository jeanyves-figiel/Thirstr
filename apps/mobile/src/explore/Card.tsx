import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Card } from '../api/types';
import { distanceLabel, tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { Photo, Scrim, useAccent, VerifiedTick } from '../ui';
import { IntentBar } from './IntentRing';
import { a11yLabel, dayLabel, rangeLabel, tileTag, TravelLabel } from '../travel/travel';
import { tr } from '../i18n/travel';
import { TileRing } from '../moments/Ring';
import { watchedAll } from '../moments/api';
import { mx } from '../i18n/moments';

// R-04.5 grid card / R-04.4 tray card: photo, name, tick, online dot, distance, Now/Exact badge.
export function ProfileTile({ card, onPress, onLongPress, tray, selected }: { card: Card; onPress: () => void; onLongPress?: () => void; tray?: boolean; selected?: boolean }) {
  const accent = useAccent();
  const hot = !!card.now || card.exact;
  const precise = card.distance?.kind === 'area' && !!card.distance.precise;
  // F-20 R-20.10: visitors (and travellers already here) carry a sky outline + reason.
  const trip = card.trip ?? null;
  const where = trip ? (trip.here ? tr.visitingUntil(dayLabel(trip.last_day)) : `${tr.visiting} ${rangeLabel(trip.first_day, trip.last_day)}`) : distanceLabel(card.distance);
  // F-21 R-21.9 (#212): gradient ring = new Moment, grey = all seen.
  const moments = card.moments && card.moments.live > 0 ? card.moments : null;
  const unseen = !!moments?.unseen && !watchedAll(card.id);
  const label = `${card.display_name}, ${card.age}${card.verified ? ', verified' : ''}, ${trip ? a11yLabel(trip) : distanceLabel(card.distance)}${card.now ? ', ' + tx.now[card.now.status] : ''}${moments ? ', ' + mx.openA11y('', moments.live, unseen).replace(/^: /, '') : ''}`;
  return (
    <Pressable
      testID={`tile-${card.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        tray
          ? { width: 132, height: 172, borderRadius: radius.tray, borderWidth: 2, borderColor: hot ? accent : 'transparent' }
          : { flex: 1, aspectRatio: 3 / 4, borderRadius: 18, borderWidth: selected ? 3 : 0, borderColor: accent },
        { overflow: 'hidden', backgroundColor: color.bgRaised },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Photo uri={card.photo} id={card.id} label={`${card.display_name}'s photo`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <Scrim height="60%" max={tray ? 0.92 : 0.85} />
      {trip ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18, borderWidth: 2.5, borderColor: color.travel }} /> : null}
      {moments && !trip ? <TileRing unseen={unseen} radius={tray ? radius.tray : 18} /> : null}
      {card.online ? (
        <View accessible accessibilityLabel="Online" style={{ position: 'absolute', top: 8, right: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: color.sport, borderWidth: 2, borderColor: color.bgBase }} />
      ) : null}
      {trip ? (
        <View style={{ position: 'absolute', top: space.s - 2, left: space.s - 2 }}>
          <TravelLabel small text={tileTag(trip)} />
        </View>
      ) : card.now || card.exact ? (
        <View style={{ position: 'absolute', top: space.s, left: space.s, paddingHorizontal: space.s, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: card.exact ? color.trust : accent }}>
          <Text style={{ ...type.caption, fontSize: 10, color: color.onAccent }}>{card.now ? tx.now[card.now.status] : 'Exact'}</Text>
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: space.s + 2, right: space.s + 2, bottom: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {/* #124: a long name shortens, the age always stays visible. */}
          <Text numberOfLines={1} style={{ ...type.headline, fontSize: tray ? 15 : 14, color: color.fgPrimary, flexShrink: 1 }}>
            {card.display_name}
            {tray ? ',' : ''}
          </Text>
          <Text style={{ ...type.headline, fontSize: tray ? 15 : 14, color: color.fgPrimary }}>{card.age}</Text>
          {card.verified ? <VerifiedTick size={13} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {/* #197: teal dot = he shares a closer distance (~50 m) */}
          {precise ? <View accessibilityLabel="Closer distance" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.trust }} /> : null}
          <Text numberOfLines={1} style={{ ...type.meta, fontSize: 11, color: precise ? color.trust : color.fgSecondary, flexShrink: 1, fontVariant: ['tabular-nums'] }}>
            {[where, card.now?.text].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {/* R-04.19: his intents along the bottom edge */}
      {tray ? null : <IntentBar intents={card.intents} />}
    </Pressable>
  );
}

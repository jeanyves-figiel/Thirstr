import React from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Place } from '../api/types';
import { distanceLabel } from '../i18n/app';
import { ap } from '../i18n/addplace';
import { pl } from '../i18n/places';
import { color, font, radius, space, type } from '../theme/tokens';
import { PLACE_KINDS, PlaceKind } from './mapShared';

// F-04 R-04.20 (#113): place layers. Places are rounded squares so they never read as people.

const stroke = { fill: 'none', stroke: color.onAccent, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function PlaceIcon({ p, size = 18 }: { p: Pick<Place, 'type' | 'kind'>; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {p.type !== 'venue' ? (
        <Path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" {...stroke} />
      ) : p.kind === 'gym' ? (
        <Path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" {...stroke} strokeWidth={2.4} />
      ) : p.kind === 'sauna' ? (
        <>
          <Path d="M8 3c-1.5 2 1.5 3 0 5M12 3c-1.5 2 1.5 3 0 5M16 3c-1.5 2 1.5 3 0 5" {...stroke} />
          <Path d="M4 13h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" {...stroke} />
        </>
      ) : (
        <>
          <Path d="M9 18V5l12-2v13" {...stroke} />
          <Circle cx={6} cy={18} r={3} {...stroke} />
          <Circle cx={18} cy={16} r={3} {...stroke} />
        </>
      )}
    </Svg>
  );
}

const isParty = (p: Pick<Place, 'type'>) => p.type !== 'venue';
const placeBg = (p: Pick<Place, 'type'>) => (isParty(p) ? color.personal : color.bgInverse);

/** Party time tag: "TONIGHT 23:00" today, else "Sat 23:00"; live parties show their end. */
export function partyTag(p: Place, now = new Date()): string | null {
  if (!isParty(p) || !p.starts_at) return null;
  const st = new Date(p.starts_at);
  const hm = st.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  if (st.toDateString() === now.toDateString()) return p.type === 'event' ? `${pl.tonight} ${hm}` : hm;
  return `${st.toLocaleDateString([], { weekday: 'short' })} ${hm}`;
}

export function PlaceMarker({ p, selected }: { p: Place; selected?: boolean }) {
  const tag = partyTag(p);
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          backgroundColor: placeBg(p),
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: selected ? 3 : 0,
          borderColor: color.halo,
          shadowColor: color.shadow,
          shadowOpacity: 0.45,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        }}
      >
        <PlaceIcon p={p} />
      </View>
      {tag ? (
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color.bgBase }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 10, letterSpacing: 0.2, color: color.personal }}>{tag}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Chips above the grid sheet (left of Locate me). On = filled white (Parties yellow); off = solid raised ink (#250). */
export function PlaceChips({ active, onToggle }: { active: PlaceKind[]; onToggle: (k: PlaceKind) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={pl.layersLabel} contentContainerStyle={{ gap: 6, paddingRight: space.s }}>
      {PLACE_KINDS.map((k) => {
        const on = active.includes(k);
        const fill = k === 'parties' ? color.personal : color.bgInverse;
        return (
          <Pressable
            key={k}
            testID={`layer-${k}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={pl.layer[k]}
            onPress={() => onToggle(k)}
            style={({ pressed }) => [
              {
                height: 34,
                paddingHorizontal: 12,
                borderRadius: 17,
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: on ? fill : color.line,
                // #250: solid when off, so map markers never show through the chip.
                backgroundColor: on ? fill : color.bgRaised,
                shadowColor: color.shadow,
                shadowOpacity: 0.35,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ fontFamily: font.heavy, fontSize: 12, color: on ? color.onAccent : color.fgSecondary }}>{pl.layer[k]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Opens the phone's maps app at a place's public coordinates (user-initiated). */
export function directions(p: Place) {
  const q = encodeURIComponent(p.type === 'event' && p.venue_name ? p.venue_name : p.name);
  const url =
    Platform.OS === 'ios'
      ? `maps://?daddr=${p.lat},${p.lng}&q=${q}`
      : Platform.OS === 'android'
        ? `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${q})`
        : `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`;
  Linking.openURL(url).catch(() => {});
}

function hereLine(p: Place): string | null {
  if (p.type === 'party' && p.seats) return pl.seats(p.seats.taken, p.seats.capacity);
  if (!p.here) return null;
  return p.here === 'a_few' ? pl.aFew : pl.here(p.here);
}

export function PlaceCard({ p, onClose, onCheckIn, onJoin }: { p: Place; onClose: () => void; onCheckIn: () => void; onJoin: () => void }) {
  const tag = partyTag(p);
  const meta = [p.type === 'event' && p.venue_name ? pl.at(p.venue_name) : null, tag && p.type !== 'venue' ? tag : null, p.distance ? distanceLabel(p.distance) : null].filter(Boolean).join(' · ');
  const line = p.type === 'party' ? [hereLine(p), pl.areaOnly].filter(Boolean).join(' · ') : [hereLine(p), p.hours ? pl.open(p.hours) : null].filter(Boolean).join(' · ');
  const primary =
    p.type === 'venue'
      ? { label: pl.checkIn, onPress: onCheckIn }
      : p.type === 'party'
        ? { label: pl.join, onPress: onJoin }
        : p.url
          ? { label: pl.details, onPress: () => Linking.openURL(p.url as string).catch(() => {}) }
          : null;
  const btn = { height: 44, borderRadius: 22, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 18 };
  return (
    <View
      testID="place-card"
      accessibilityViewIsModal={false}
      style={{
        padding: space.l,
        borderRadius: radius.tray,
        backgroundColor: color.bgRaised,
        borderWidth: 1,
        borderColor: color.line,
        gap: 10,
        shadowColor: color.shadow,
        shadowOpacity: 0.5,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: placeBg(p), alignItems: 'center', justifyContent: 'center' }}>
          <PlaceIcon p={p} size={22} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 11, letterSpacing: 0.7, color: isParty(p) ? color.personal : color.fgMuted }}>{pl.kind[p.kind] ?? p.kind}</Text>
          <Text numberOfLines={2} style={{ ...type.title, fontSize: 19, lineHeight: 24, color: color.fgPrimary }}>
            {p.name}
          </Text>
          {meta ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{meta}</Text> : null}
        </View>
        <Pressable
          testID="place-close"
          accessibilityRole="button"
          accessibilityLabel={pl.close}
          onPress={onClose}
          hitSlop={8}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <Path d="M6 6l12 12M18 6L6 18" fill="none" stroke={color.fgPrimary} strokeWidth={2.6} strokeLinecap="round" />
          </Svg>
        </Pressable>
      </View>
      {line ? <Text style={{ ...type.meta, color: color.fgSoft }}>{line}</Text> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {primary ? (
          <Pressable testID="place-primary" accessibilityRole="button" onPress={primary.onPress} style={({ pressed }) => [btn, { flex: 1, backgroundColor: color.bgInverse }, pressed && { opacity: 0.85 }]}>
            <Text style={{ ...type.headline, fontSize: 15, color: color.onAccent }}>{primary.label}</Text>
          </Pressable>
        ) : null}
        {p.type !== 'party' ? (
          <Pressable
            testID="place-directions"
            accessibilityRole="button"
            onPress={() => directions(p)}
            style={({ pressed }) => [btn, primary ? { flexShrink: 0 } : { flex: 1 }, { borderWidth: 1, borderColor: color.line }, pressed && { opacity: 0.85 }]}
          >
            <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{pl.directions}</Text>
          </Pressable>
        ) : null}
      </View>
      {p.source === 'osm' ? <Text style={{ ...type.meta, fontSize: 11, color: color.fgMuted }}>{pl.osm}</Text> : null}
      {p.type === 'venue' && p.source === 'member' ? <Text style={{ ...type.meta, fontSize: 11, color: color.fgMuted }}>{ap.member}</Text> : null}
    </View>
  );
}

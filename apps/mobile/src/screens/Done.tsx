import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Me } from '../api/client';
import { o } from '../i18n/onboarding';
import { BigButton, Enter, k } from '../onboarding/kit';
import { color, font, radius, space, tileFor } from '../theme/tokens';
import { VerifiedTick } from '../ui';

const HERE_FILL: Record<string, string> = { hookup: color.hookup, tonight: color.hookup, chat: color.friends, friends: color.friends, sport: color.sport };

// S-07 (R-02.1g): "You're in" with the profile card as others see it.
export function DoneScreen({ me, onContinue }: { me: Me; onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const p = me.profile;
  const photo = p?.photos.find((x) => x.slot === 0)?.url ?? null;
  const name = p?.display_name ?? '';
  const level = me.location?.level ?? 'area';
  return (
    <View style={[k.root, { paddingTop: insets.top + 56, paddingBottom: Math.max(insets.bottom, space.l) + space.xs, paddingHorizontal: space.xxl, gap: 18 }]}>
      <Enter style={{ gap: space.m }}>
        <Text style={d.title} accessibilityRole="header">
          {o.done.title(name)}
        </Text>
        <Text style={k.sub}>{o.done.sub}</Text>
      </Enter>
      <Enter delay={120} style={d.card}>
        <View style={[d.photo, { backgroundColor: tileFor(p?.id ?? 'x') }]}>
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} accessibilityLabel={`${name}'s photo 1`} />
          ) : (
            <View style={d.noPhoto}>
              <Text style={d.initial}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
            </View>
          )}
          <View style={d.loc}>
            <View style={d.locDot} />
            <Text style={d.locText}>{o.done.level[level]}</Text>
          </View>
        </View>
        <View style={d.meta}>
          <View style={d.nameRow}>
            <Text style={d.name}>
              {name}
              {p?.age ? `, ${p.age}` : ''}
            </Text>
            {me.verified ? <VerifiedTick size={20} /> : null}
          </View>
          <View style={d.chips}>
            {(p?.here_for ?? []).map((h) => (
              <Text key={h} style={[d.chip, { backgroundColor: HERE_FILL[h] ?? color.bgOverlay }]}>
                {o.herefor.tiles[h]?.[0] ?? h}
              </Text>
            ))}
          </View>
        </View>
      </Enter>
      {photo ? null : (
        <Enter delay={200} style={d.nudge}>
          <Text style={d.nudgeText}>{o.photo.laterNote}</Text>
        </Enter>
      )}
      <View style={{ flex: 1 }} />
      <BigButton testID="done-continue" title={o.done.cta} onPress={onContinue} />
    </View>
  );
}

const d = StyleSheet.create({
  title: { fontFamily: font.heavy, fontSize: 40, lineHeight: 42, letterSpacing: -1.2, color: color.fgPrimary },
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgRaised },
  noPhoto: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: font.heavy, fontSize: 96, color: color.fgPrimary, opacity: 0.35 },
  nudge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: 'rgba(255,203,61,0.14)' },
  nudgeText: { fontFamily: font.bold, fontSize: 14, color: color.personal },
  photo: { height: 300 },
  loc: { position: 'absolute', left: 14, top: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: color.bgRaised },
  locDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.trust },
  locText: { fontFamily: font.heavy, fontSize: 12, color: color.trust },
  meta: { padding: 18, gap: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  name: { fontFamily: font.heavy, fontSize: 24, letterSpacing: -0.5, color: color.fgPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 5, borderRadius: radius.pill, fontFamily: font.heavy, fontSize: 12, color: color.onAccent },
});

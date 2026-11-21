import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useSession } from '../app/session';
import { opt, tx } from '../i18n/app';
import { v3 } from '../i18n/v3';
import { LENSES } from '../profile/lens';
import { previewOf } from '../profile/ProfileScreen';
import { color, font, modeColor, radius, space, tileFor, type } from '../theme/tokens';
import { ErrorText, Icon, Photo, Segmented } from '../ui';
import { LensRing } from '../ui/LensRing';
import { getLocal } from './localFields';
import { AUDIENCES, type Audience, type Missing, whatTheyMiss } from './look';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void };
type Surface = 'map' | 'grid' | 'profile';
const SURFACES: Surface[] = ['map', 'grid', 'profile'];
const CHIP_KEYS = ['looking_for', 'position', 'hosting', 'sports', 'sport_level', 'schedule', 'languages', 'tribes', 'relationship', 'build', 'hiv', 'prep'];
const cap = { ...type.caption, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' as const, color: color.fgMuted };

// S-66 How others see you (#114, F-06 R-06.7/R-06.7a, mockup option A + B's full screen):
// lens × viewer × surface (map / grid / profile), "What X doesn't see" with Change links,
// "Open full screen" → S-20 preview with "Seen by … in …" pills.
export function LensPreviewScreen({ navigation }: { navigation: Nav }) {
  const { me, mode, setMode, refresh } = useSession();
  const L = v3.look;
  const p = me.profile ?? me.profiles?.[0];
  const [aud, setAud] = useState<Audience>('stranger');
  const [surf, setSurf] = useState<Surface>('map');
  const [local, setLocalFields] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (p) getLocal(p.id).then(setLocalFields, () => {});
  }, [p]);
  const view = useMemo(() => (p ? previewOf(p, aud, local, me.verified, mode) : null), [p, aud, local, me.verified, mode]);
  const missing = useMemo(() => (p ? whatTheyMiss(p, aud, mode, aud === 'chats' ? local : {}) : []), [p, aud, mode, local]);
  if (!p || !view) return null;

  const showIn = p.show_in ?? ['hookup'];
  const shown = showIn.includes(mode);
  const tone = modeColor[mode];
  const main = view.photos[0] ?? null;
  const level = me.location?.level ?? 'city';
  const hidden = level === 'hidden';

  const turnOn = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('PATCH', `/me/profiles/${p.id}`, { show_in: LENSES.filter((x) => x === mode || showIn.includes(x)) });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };
  const change = (m: Missing) => (m.kind === 'albums' ? navigation.navigate('Albums') : navigation.navigate('EditProfile', { id: p.id }));
  const missLine = (m: Missing): [string, string] => {
    const names = m.keys.map((k) => tx.edit.fields[k as keyof typeof tx.edit.fields] ?? k).slice(0, 3).join(', ') + (m.keys.length > 3 ? ` +${m.keys.length - 3}` : '');
    if (m.kind === 'photos') return [L.miss.photos(m.count), L.miss.lens];
    if (m.kind === 'albums') return [L.miss.albums, L.miss.albumsWhy];
    return [names, L.miss[m.kind]];
  };

  const chips: { k: string; label: string; vis: string }[] = [];
  for (const k of CHIP_KEYS) {
    const v = view.fields[k];
    const vals = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
    for (const x of vals) if (chips.length < 8) chips.push({ k, label: opt(String(x), k), vis: p.visibility_map[k] ?? 'public' });
  }
  const chipTone = (vis: string) => (vis === 'verified' ? color.trust : vis === 'chats' ? color.personal : tone);

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: 140, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
        {L.title}
      </Text>

      <View style={{ gap: space.s }}>
        <Text style={cap}>{L.browsing}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {LENSES.map((m) => {
            const on = m === mode;
            const inIt = showIn.includes(m);
            return (
              <Pressable
                key={m}
                testID={`look-lens-${m}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(m)}
                style={{
                  flex: 1,
                  minHeight: 54,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderStyle: inIt || on ? 'solid' : 'dashed',
                  borderColor: on || inIt ? modeColor[m] : color.line,
                  backgroundColor: on ? modeColor[m] : color.bgRaised,
                }}
              >
                <Text style={{ ...type.headline, fontSize: 14, color: on ? color.onAccent : inIt ? modeColor[m] : color.fgMuted }}>{tx.modes[m]}</Text>
                <Text style={{ ...type.caption, fontSize: 10, color: on ? color.onAccent : color.fgSecondary }}>{inIt ? L.youreIn : L.youreOff}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[cap, { marginTop: space.xs }]}>{L.theyAre}</Text>
        <Segmented label={L.theyAre} value={aud} onChange={setAud} options={AUDIENCES.map((a) => ({ value: a, label: L.aud[a] }))} />
      </View>

      {!shown ? (
        <View testID="lens-preview-off" style={{ borderWidth: 2, borderStyle: 'dashed', borderColor: color.line, borderRadius: radius.md, padding: space.xl, alignItems: 'center', gap: space.m }}>
          <Icon.EyeOff size={26} c={color.fgMuted} />
          <Text style={{ ...type.headline, color: color.fgPrimary, textAlign: 'center' }}>{L.off(tx.modes[mode])}</Text>
          <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>{L.offSub(tx.modes[mode])}</Text>
          <Pressable testID="look-turn-on" accessibilityRole="button" disabled={busy} onPress={turnOn} style={{ height: 44, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: tone, justifyContent: 'center' }}>
            <Text style={{ ...type.headline, fontSize: 15, color: color.onAccent }}>{L.turnOn(tx.modes[mode])}</Text>
          </Pressable>
          <ErrorText text={err} />
        </View>
      ) : (
        <View style={{ gap: space.m }}>
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: space.xl, borderBottomWidth: 1, borderBottomColor: color.lineSubtle }}>
            {SURFACES.map((x) => (
              <Pressable key={x} testID={`look-surf-${x}`} accessibilityRole="tab" accessibilityState={{ selected: surf === x }} onPress={() => setSurf(x)} style={{ height: 44, justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: surf === x ? tone : 'transparent' }}>
                <Text style={{ ...type.headline, fontSize: 14, color: surf === x ? color.fgPrimary : color.fgMuted }}>{L.surf[x]}</Text>
              </Pressable>
            ))}
          </View>

          {surf === 'map' ? (
            <View testID="look-map" style={{ gap: space.s }}>
              <View style={{ height: 280, borderRadius: radius.md, backgroundColor: color.bgMap, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ position: 'absolute', left: -20, right: -20, top: 80, height: 10, backgroundColor: color.mapRoad, transform: [{ rotate: '-8deg' }] }} />
                <View style={{ position: 'absolute', left: -20, right: -20, top: 200, height: 6, backgroundColor: color.mapRoadMinor, transform: [{ rotate: '5deg' }] }} />
                <View style={{ position: 'absolute', top: -20, bottom: -20, left: '30%', width: 8, backgroundColor: color.mapRoad, transform: [{ rotate: '12deg' }] }} />
                <View style={{ position: 'absolute', right: -30, bottom: -40, width: 160, height: 120, borderRadius: 60, backgroundColor: color.mapWater }} />
                {hidden ? (
                  <View style={{ alignItems: 'center', gap: space.s, padding: space.l, borderRadius: radius.sm, backgroundColor: color.scrim }}>
                    <Icon.EyeOff size={24} c={color.trust} />
                    <Text style={{ ...type.meta, color: color.fgPrimary, textAlign: 'center' }}>{L.mapHidden}</Text>
                  </View>
                ) : (
                  <>
                    {level !== 'exact' ? (
                      <View style={{ position: 'absolute', width: level === 'city' ? 240 : 140, height: level === 'city' ? 240 : 140, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.trust, backgroundColor: 'rgba(61,214,195,0.08)' }} />
                    ) : null}
                    <LensRing modes={showIn} size={60}>
                      <Photo uri={main} id={p.id} label={p.display_name} style={{ width: '100%', height: '100%' }} />
                    </LensRing>
                    <Text style={{ ...type.headline, fontSize: 12, color: color.fgPrimary, marginTop: 4 }}>
                      {p.display_name}, {p.age}
                    </Text>
                    <View style={{ position: 'absolute', left: space.m, bottom: space.m, height: 28, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: color.bgRaised, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon.Pin size={12} c={color.trust} />
                      <Text style={{ ...type.meta, fontSize: 12, fontFamily: font.bold, color: color.trust }}>{L.zone[level] ?? L.zone.area}</Text>
                    </View>
                  </>
                )}
              </View>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{L.ringNote}</Text>
            </View>
          ) : null}

          {surf === 'grid' ? (
            <View testID="look-grid" style={{ gap: space.s }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {Array.from({ length: 9 }, (_, i) =>
                  i === 4 ? (
                    <View key="me" style={{ width: '32.4%', aspectRatio: 3 / 4, borderRadius: 10, overflow: 'hidden', borderWidth: 2.5, borderColor: tone }}>
                      <Photo uri={main} id={p.id} label={p.display_name} style={{ width: '100%', height: '100%' }} />
                      <View style={{ position: 'absolute', top: 6, right: 6, height: 18, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: color.bgInverse, justifyContent: 'center' }}>
                        <Text style={{ ...type.caption, fontSize: 10, color: color.onAccent }}>{L.you}</Text>
                      </View>
                      <Text style={{ position: 'absolute', left: 6, bottom: 6, ...type.headline, fontSize: 12, color: color.fgPrimary }}>
                        {p.display_name}, {p.age}
                      </Text>
                    </View>
                  ) : (
                    <View key={i} style={{ width: '32.4%', aspectRatio: 3 / 4, borderRadius: 10, backgroundColor: tileFor(String(i * 7919)), opacity: 0.5 }} />
                  ),
                )}
              </View>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{L.gridNote}</Text>
            </View>
          ) : null}

          {surf === 'profile' ? (
            <View testID={`lens-preview-${mode}`} style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
              <View style={{ height: 240 }}>
                <Photo uri={main} id={p.id} label={p.display_name} style={{ width: '100%', height: '100%' }} />
                <View style={{ position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', gap: 4 }}>
                  {view.photos.map((_, i) => (
                    <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: color.fgPrimary, opacity: i === 0 ? 1 : 0.35 }} />
                  ))}
                </View>
                <Text style={{ position: 'absolute', left: 14, bottom: 12, ...type.title, color: color.fgPrimary }}>
                  {p.display_name}, {p.age}
                </Text>
              </View>
              <View style={{ padding: space.m, gap: space.m }}>
                {chips.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {chips.map((c) => (
                      <View key={c.k + c.label} style={{ height: 30, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1.5, borderColor: chipTone(c.vis), justifyContent: 'center' }}>
                        <Text style={{ ...type.meta, fontFamily: font.bold, color: chipTone(c.vis) }}>{c.label}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Pressable testID="look-full" accessibilityRole="button" onPress={() => navigation.navigate('Profile', { id: p.id, preview: aud, mode })} style={{ height: 44, borderRadius: radius.pill, backgroundColor: color.bgInverse, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...type.headline, fontSize: 15, color: color.onAccent }}>{L.full}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={{ gap: space.s }}>
            <Text style={cap}>{L.missTitle(L.audLong[aud])}</Text>
            {missing.map((m) => {
              const [what, why] = missLine(m);
              return (
                <View key={m.kind} testID={`look-miss-${m.kind}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, backgroundColor: color.bgRaised, borderRadius: 14, paddingLeft: space.m }}>
                  <Icon.Lock size={16} c={color.fgMuted} />
                  <Text style={{ flex: 1, ...type.meta, color: color.fgPrimary }}>
                    <Text style={{ fontFamily: font.heavy }}>{what}</Text>
                    <Text style={{ color: color.fgSecondary }}> · {why}</Text>
                  </Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${L.change}: ${what}`} onPress={() => change(m)} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.m }}>
                    <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.trust }}>{L.change}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

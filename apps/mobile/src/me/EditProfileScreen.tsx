import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useOptions } from '../api/options';
import type { MyProfile } from '../api/types';
import { useSession } from '../app/session';
import { opt, tx } from '../i18n/app';
import { pe } from '../i18n/profileEdit';
import { fieldType } from '../profile/fieldMeta';
import { quickWins, type Win } from '../profile/quickWins';
import { filled, sectionKeys, SECTIONS, type SectionId } from '../profile/sections';
import { color, font, modeColor, radius, space, type } from '../theme/tokens';
import { Icon, Loading } from '../ui';
import { feel } from '../ui/haptics';
import { getLocal } from './localFields';
import { PhotoEditor, type PhotoEditorHandle } from './PhotoEditor';
import { ProfileLinks } from './ProfileLinks';

type Nav = { navigate: (s: string, p?: object) => void };
type Params = { id?: string; focus?: 'sport' };

// S-74 Edit profile hub (#219, F-06 R-06.8a/b, mockup A): photos, the 3 quick wins that raise the
// profile most, then one row per section. Each section is its own short page (S-75) that saves itself.
export function EditProfileScreen({ route, navigation }: { route: { params?: Params }; navigation: Nav }) {
  const { me, setMe } = useSession();
  const options = useOptions();
  const fromSession: MyProfile | undefined = (me.profiles ?? []).find((p) => p.id === route.params?.id) ?? me.profile ?? me.profiles?.[0];
  const p = fromSession;
  const [local, setLocalVals] = useState<Record<string, unknown>>({});
  const photos = useRef<PhotoEditorHandle>(null);

  useFocusEffect(
    useCallback(() => {
      if (fromSession) getLocal(fromSession.id).then(setLocalVals, () => {});
    }, [fromSession]),
  );
  // Old entry point: turning Sport on opened Edit profile at the sport fields.
  const focus = route.params?.focus;
  useEffect(() => {
    if (focus === 'sport' && fromSession) navigation.navigate('EditSection', { id: fromSession.id, section: 'sport' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  if (!options || !p) return <Loading />;

  const vals = { ...p.fields, ...local };
  const known = (k: string) => !!options.defaults[k];
  const livePhotos = p.photos.filter((x) => x.status !== 'rejected' && x.url).length;
  const wins = quickWins(vals, livePhotos, p.show_in ?? ['hookup']);
  const pct = Math.max(0, Math.min(100, p.completeness));
  const after = Math.min(100, pct + wins.reduce((a, w) => a + w.gain, 0));
  const open = (section: SectionId, f?: string) => navigation.navigate('EditSection', { id: p.id, section, focus: f });
  const doWin = (w: Win) => {
    feel('tap');
    if (w.target.kind === 'photos') photos.current?.addNext();
    else open(w.target.section, w.target.key);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.l, paddingTop: space.xs, gap: space.xl, paddingBottom: 140, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 28, lineHeight: 34, color: color.fgPrimary }}>
          {tx.edit.title}
        </Text>

        <PhotoEditor
          ref={photos}
          profile={p}
          accent={color.hookup}
          onChange={(x) => setMe({ ...me, profile: me.profile?.id === x.id ? x : me.profile, profiles: (me.profiles ?? []).map((y) => (y.id === x.id ? x : y)) })}
        />

        {wins.length ? (
          <View testID="quick-wins" style={{ padding: space.l, paddingTop: space.m, gap: space.m, borderRadius: radius.md, borderWidth: 1.5, borderColor: `${color.hookup}73`, backgroundColor: `${color.hookup}1A` }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" style={{ ...type.headline, color: color.fgPrimary }}>
                {pe.wins(wins.length)}
              </Text>
              <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.alertIcon }}>{pe.winsRange(pct, after)}</Text>
            </View>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 6, borderRadius: 3, backgroundColor: color.line, overflow: 'hidden' }}>
              <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: color.hookup }} />
            </View>
            <View style={{ gap: 6 }}>
              {wins.map((w) => (
                <Pressable
                  key={w.id}
                  testID={`win-${w.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${pe.win[w.id](w.count ?? 1)}, +${w.gain}%`}
                  onPress={() => doWin(w)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 46, paddingHorizontal: space.m, borderRadius: 14, backgroundColor: pressed ? color.bgOverlay : color.bgRaised })}
                >
                  <Text style={{ ...type.body, fontFamily: font.bold, color: color.fgPrimary, flex: 1 }}>{pe.win[w.id](w.count ?? 1)}</Text>
                  <Text style={{ ...type.caption, fontSize: 12, color: color.alertIcon }}>+{w.gain}%</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: space.s }}>
          <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: color.fgMuted, marginHorizontal: space.xs }}>{pe.everythingElse}</Text>
          <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
            {SECTIONS.map((s, i) => {
              const keys = sectionKeys(s.id, known);
              const isBasics = s.id === 'basics';
              const total = keys.length + (isBasics ? 1 : 0);
              const done = keys.filter((k) => filled(vals[k])).length + (isBasics && p.display_name ? 1 : 0);
              const sub = s.id === 'health' ? pe.healthSub : summary(isBasics ? p.display_name : null, keys, vals) || pe.empty;
              return (
                <Pressable
                  key={s.id}
                  testID={`section-${s.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${pe.sections[s.id]}, ${pe.of(done, total)}`}
                  onPress={() => open(s.id)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingHorizontal: space.l, paddingVertical: space.s, borderTopWidth: i ? 1 : 0, borderTopColor: color.lineSubtle, backgroundColor: pressed ? color.bgOverlay : 'transparent' })}
                >
                  <View style={{ width: 14, alignItems: 'center' }}>
                    {s.lens ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: modeColor[s.lens] }} /> : s.id === 'health' ? <Icon.Lock size={13} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.line }} />}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ ...type.headline, color: color.fgPrimary }}>{pe.sections[s.id]}</Text>
                    <Text numberOfLines={1} style={{ ...type.meta, color: color.fgSecondary }}>
                      {sub}
                    </Text>
                  </View>
                  <Text style={{ ...type.meta, fontFamily: font.heavy, color: done === total ? color.trust : color.fgMuted }}>{pe.count(done, total)}</Text>
                  <Icon.Next />
                </Pressable>
              );
            })}
          </View>
        </View>

        <ProfileLinks profileId={p.id} />
      </ScrollView>
    </View>
  );
}

/** Up to 3 filled values, readable ("180 cm · Muscular · French, English"). Free text is left out. */
function summary(name: string | null, keys: string[], vals: Record<string, unknown>): string {
  const parts: string[] = name ? [name] : [];
  for (const k of keys) {
    if (parts.length >= 3) break;
    const v = vals[k];
    if (!filled(v)) continue;
    const t = fieldType(k);
    if (t === 'text' || t === 'month' || t === 'bool') continue;
    if (k === 'height_cm') parts.push(`${v} cm`);
    else if (k === 'weight_kg') parts.push(`${v} kg`);
    else if (Array.isArray(v)) parts.push((v as string[]).slice(0, 2).map((x) => opt(x, k)).join(', '));
    else parts.push(opt(String(v), k));
  }
  return parts.join(' · ');
}

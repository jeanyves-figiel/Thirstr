import React from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PlusSource } from '../api/client';
import { useSession } from '../app/session';
import { plx } from '../i18n/plus';
import { color, font, radius, space, type } from '../theme/tokens';
import { Plane } from '../travel/travel';
import { Icon } from '../ui/icons';
import { Group, Row } from '../me/settings/parts';
import { PlusMark } from './PlusLimit';
import { manageUrl } from './plus';

// S-90 Plus screen and Settings › Plus (F-23 R-23.15, #318, mockup approved 2026-11-22:
// https://claude.ai/artifact/C2t81w4khbvFPRxPgXdNRn). Buying lands with billing (#321, open
// beta): until then the Free state says when Plus opens; prices are never typed in the app (R-23.14).

const TONES = [color.hookup, color.personal, color.friends, color.travel, color.sport, color.trust];

function BenefitIcon({ i }: { i: number }) {
  const c = color.onAccent;
  switch (i) {
    case 0:
      return <Icon.Pin size={16} c={c} />;
    case 1:
      return <Icon.Party size={16} c={c} />;
    case 2:
      return <Icon.Eye size={16} c={c} />;
    case 3:
      return <Plane size={16} c={c} />;
    case 4:
      return <Icon.Timer size={16} c={c} />;
    default:
      return <Icon.Translate size={16} c={c} />;
  }
}

export function Benefits() {
  return (
    <View style={{ gap: space.m }} accessibilityRole="list">
      {plx.benefits.map(([t, s], i) => (
        <View key={t} style={{ flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: TONES[i], alignItems: 'center', justifyContent: 'center' }}>
            <BenefitIcon i={i} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.body, fontFamily: font.heavy, fontSize: 14.5, lineHeight: 18, color: color.fgPrimary }}>{t}</Text>
            <Text style={{ ...type.meta, fontSize: 12.5, color: color.fgSecondary }}>{s}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function Pledge() {
  return (
    <View testID="plus-pledge" style={{ borderWidth: 1.5, borderColor: color.trust, backgroundColor: color.trustTint, borderRadius: radius.md - 6, padding: space.m, gap: 2 }}>
      <Text style={{ ...type.body, fontFamily: font.heavy, fontSize: 14, color: color.trust }}>{plx.pledgeTitle}</Text>
      <Text style={{ ...type.meta, fontSize: 12.5, color: color.fgSecondary }}>{plx.pledge}</Text>
    </View>
  );
}

function titleFor(source: PlusSource, active: boolean) {
  if (source === 'beta') return plx.titleBeta;
  if (source === 'safe_mode') return plx.titleSafe;
  return active ? plx.titleActive : plx.title;
}

export function PlusScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const source: PlusSource = me.plus?.source ?? 'beta';
  const active = me.plus?.active ?? true;
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.s, paddingBottom: insets.bottom + space.xl, gap: space.xl, maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="header" accessibilityLabel="Thirstr Plus">
            <Text style={{ ...type.title, fontSize: 24, letterSpacing: -1, color: color.fgPrimary }}>
              thirst<Text style={{ color: color.hookup }}>r</Text>
            </Text>
            <PlusMark size={24} r={8} />
          </View>
          <Pressable testID="plus-close" accessibilityRole="button" accessibilityLabel={plx.close} onPress={() => navigation.goBack()} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Close size={16} c={color.fgSecondary} />
          </Pressable>
        </View>
        <Text style={{ ...type.display, fontSize: 28, lineHeight: 32, color: color.fgPrimary }}>{titleFor(source, active)}</Text>
        <Benefits />
        {!active ? (
          <View testID="plus-soon" style={{ borderRadius: radius.md - 6, backgroundColor: color.bgRaised, padding: space.m, gap: 2 }}>
            <Text style={{ ...type.body, fontFamily: font.heavy, fontSize: 14, color: color.fgPrimary }}>{plx.soonTitle}</Text>
            <Text style={{ ...type.meta, fontSize: 12.5, color: color.fgSecondary }}>{plx.soon}</Text>
          </View>
        ) : null}
        <Pledge />
        <View style={{ flex: 1 }} />
        <Pressable testID="plus-got-it" accessibilityRole="button" onPress={() => navigation.goBack()} style={({ pressed }) => ({ height: 52, borderRadius: radius.pill, backgroundColor: color.bgInverse, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ ...type.headline, color: color.onAccent }}>{plx.gotIt}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          <Text accessibilityRole="link" onPress={() => Linking.openURL('https://thirstr.fun/privacy/').catch(() => {})} style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>
            {plx.privacy}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** Settings row value (R-23.15). */
export const plusRowValue = (source: PlusSource | undefined) => plx.rowSub[source ?? 'beta'];

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Settings › Plus (mockup C): state card, store links when bought, what Plus adds.
export function PlusSettingsScreen({ navigation }: { navigation: { navigate: (r: string, p?: object) => void } }) {
  const { me } = useSession();
  const p = me.plus ?? { active: true, source: 'beta' as const };
  const bought = p.source === 'store' || p.source === 'lifetime';
  const tone = p.grace_until ? color.warn : p.active ? color.trust : color.fgMuted;
  const sub = p.grace_until ? plx.grace(day(p.grace_until)) : p.renews_at ? plx.renews(day(p.renews_at)) : plx.stateSub[p.source];
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.xxl, paddingBottom: 120, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 36, color: color.fgPrimary }}>
          {plx.settingsTitle}
        </Text>
        <PlusMark size={26} r={9} />
      </View>
      <View testID="plus-state" style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, padding: space.l, gap: space.s, borderWidth: p.grace_until ? 1.5 : 0, borderColor: tone }}>
        <Text style={{ alignSelf: 'flex-start', ...type.caption, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: color.onAccent, backgroundColor: tone, borderRadius: radius.pill, overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 3 }}>{plx.state[p.source]}</Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text>
      </View>
      {bought ? (
        <Group>
          {p.source === 'store' ? <Row testID="plus-manage" title={plx.manage} sub={plx.manageSub} onPress={() => Linking.openURL(manageUrl(Platform.OS)).catch(() => {})} /> : null}
        </Group>
      ) : null}
      <View style={{ gap: space.m }}>
        <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: color.fgMuted, marginHorizontal: space.xs }}>{plx.whatYouGet}</Text>
        <Benefits />
      </View>
      <Pledge />
      <Group>
        <Row testID="plus-open" title={plx.seePlus} onPress={() => navigation.navigate('Plus')} />
      </Group>
    </ScrollView>
  );
}

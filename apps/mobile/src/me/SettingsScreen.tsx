import { mod } from '../i18n/mod';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import app from '../../app.json';
import { api, clearSession } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { trx } from '../i18n/translate';
import { v3 } from '../i18n/v3';
import { wn } from '../i18n/whatsnew';
import { color, font, radius, space, type } from '../theme/tokens';
import { ErrorText, Icon } from '../ui';
import { type Prefs, prefs, setPrefs } from './prefs';
import { saverSummary, useDataSaver } from '../app/dataSaver';
import { sv } from '../i18n/saver';
import { hx } from '../i18n/help';
import { article, search as helpSearch } from '../help/kit';
import { Group, IconTile, Row, Seg, SwitchRow, useSettings } from './settings/parts';
import { plx } from '../i18n/plus';
import { PlusMark } from '../plus/PlusLimit';
import { plusRowValue } from '../plus/PlusScreen';

type Nav = { navigate: (s: string, p?: object) => void };

const S = v3.settings;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Search index (R-17.4): every setting label → the category screen that holds it.
const INDEX: [string, string][] = [
  ...[tx.me.location, S.hideUnverified, S.hideNew, S.hideHidden, S.ages, S.appearOn, ...Object.values(S.surfaces), S.distance, S.online].map((l) => [l, 'PrivacySettings'] as [string, string]),
  ...[S.whoMessage, S.explicit, S.disappear, S.receipts, tx.prefs.autoDelete, S.quick, trx.setting].map((l) => [l, 'ChatSettings'] as [string, string]),
  ...[S.notifications, ...Object.values(S.push), S.quiet].map((l) => [l, 'NotificationSettings'] as [string, string]),
  ...[S.safeMode, S.appLock, tx.prefs.verification, S.blocked, mod.list.row, S.notices].map((l) => [l, 'SafetySettings'] as [string, string]),
  ...[tx.signInEmail.row, tx.devices.title, tx.exportData.title, S.pause, S.logoutAll, S.delete].map((l) => [l, 'AccountSettings'] as [string, string]),
  [wn.title, 'WhatsNew'],
  [plx.row, 'PlusSettings'],
  [sv.title, 'DataSaverSettings'],
  [hx.row, 'Help'],
  [hx.contact, 'HelpContact'],
  [hx.feedback, 'HelpFeedback'],
];

// S-61 Settings hub v3 (#102, F-17 R-17.10): 5 categories with live summaries, App + About inline.
export function SettingsScreen({ navigation }: { navigation: Nav }) {
  const { me, signOut } = useSession();
  const { st } = useSettings();
  const [q, setQ] = useState('');
  const [pf, setPf] = useState<Prefs>(prefs());
  const ds = useDataSaver();
  const [lic, setLic] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [devices, setDevices] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ blocks: unknown[] }>('GET', '/me/blocks').then((r) => setBlocked(r.blocks.length), () => {});
    api<{ devices: unknown[] }>('GET', '/me/devices').then((r) => setDevices(r.devices.length), () => {});
  }, []);

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const seen = new Set<string>();
    return INDEX.filter(([l]) => l.toLowerCase().includes(t) && !seen.has(l) && seen.add(l)).slice(0, 12);
  }, [q]);
  // F-22 (#178): help articles show under the settings that match.
  const helpHits = useMemo(() => (q.trim().length >= 2 ? helpSearch(q).slice(0, 5) : []), [q]);

  const summary = {
    privacy: st ? `${st.hide_from_unverified ? S.sum.hideUnverified : S.sum.visibleAll} · ${S.sum.dist[st.show_distance]}` : undefined,
    chats: st ? `${S.sum.who[st.who_can_message]} · ${S.sum.explicit[st.explicit_from_strangers]}` : undefined,
    notifications: st ? [S.sum.on, st.quiet_hours ? S.sum.quiet(hh(st.quiet_hours.from), hh(st.quiet_hours.to)) : null].filter(Boolean).join(' · ') : undefined,
    safety: [S.sum.safe[me.safe_mode] ?? S.sum.safe.auto, blocked != null ? S.sum.blocked(blocked) : null].filter(Boolean).join(' · '),
    account: [me.has_email ? S.sum.email : S.sum.noEmail, devices != null ? S.sum.devices(devices) : null].filter(Boolean).join(' · '),
  };

  const cats: { key: keyof typeof summary; title: string; route: string; tone: string; icon: React.ReactNode }[] = [
    { key: 'privacy', title: S.privacy, route: 'PrivacySettings', tone: color.trust, icon: <EyeIcon /> },
    { key: 'chats', title: S.chats, route: 'ChatSettings', tone: color.friends, icon: <Icon.Chat size={20} c={color.onAccent} /> },
    { key: 'notifications', title: S.notifications, route: 'NotificationSettings', tone: color.hookup, icon: <BellIcon /> },
    { key: 'safety', title: S.safety, route: 'SafetySettings', tone: color.sport, icon: <Icon.Shield size={20} c={color.onAccent} /> },
    { key: 'account', title: S.account, route: 'AccountSettings', tone: color.personal, icon: <Icon.User size={20} c={color.onAccent} /> },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.xxl, paddingBottom: 120, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, color: color.fgPrimary }}>
        {S.title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, height: 44, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: color.bgRaised, marginTop: -space.s }}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color.fgMuted} strokeWidth={2.2} strokeLinecap="round">
          <Circle cx={11} cy={11} r={7} />
          <Path d="m20 20-4-4" />
        </Svg>
        <TextInput
          testID="settings-search"
          accessibilityLabel={S.search}
          placeholder={S.search}
          placeholderTextColor={color.fgMuted}
          value={q}
          onChangeText={setQ}
          style={{ flex: 1, ...type.body, color: color.fgPrimary, height: 44, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as object}
        />
      </View>
      <ErrorText text={err} />

      {hits ? (
        <Group>
          {hits.length || helpHits.length ? hits.map(([l, route]) => <Row key={l} title={l} sub={cats.find((c) => c.route === route)?.title} onPress={() => navigation.navigate(route)} />) : <Row title={S.noResults} />}
          {helpHits.map((m) => (
            <Row key={m.id} title={article(m.id)?.t.title ?? m.id} sub={hx.title} onPress={() => navigation.navigate('HelpArticle', { id: m.id })} />
          ))}
        </Group>
      ) : (
        <>
          <Group>
            {cats.map((c) => (
              <Row key={c.key} testID={`settings-${c.key}`} title={c.title} sub={summary[c.key]} onPress={() => navigation.navigate(c.route)} left={<IconTile tone={c.tone}>{c.icon}</IconTile>} />
            ))}
          </Group>

          {/* F-23 R-23.15 (#318): Settings › Plus. */}
          <Group>
            <Row testID="settings-plus" title={plx.row} sub={plusRowValue(me.plus?.source)} onPress={() => navigation.navigate('PlusSettings')} left={<PlusMark size={36} r={11} />} />
          </Group>

          <Group label={S.app}>
            <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.l, gap: space.m }}>
              <Text style={{ flex: 1, ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary }}>{tx.prefs.units}</Text>
              <Seg compact tone={color.bgInverse} label={tx.prefs.units} value={pf.units} options={[['km', tx.prefs.unitOpts.km], ['mi', tx.prefs.unitOpts.mi]]} onChange={(v) => setPrefs({ units: v }).then(setPf)} />
            </View>
            <Row testID="settings-data-saver" title={sv.title} value={saverSummary(ds.mode, ds.saving)} onPress={() => navigation.navigate('DataSaverSettings')} />
            {Platform.OS !== 'web' ? <SwitchRow title={tx.prefs.haptics} value={pf.haptics} onChange={(v) => setPrefs({ haptics: v }).then(setPf)} /> : null}
            <Row title={tx.prefs.language} sub={tx.prefs.languageSub} onPress={() => Linking.openSettings().catch(() => {})} />
          </Group>

          <Group>
            <Row testID="settings-help" title={hx.row} onPress={() => navigation.navigate('Help')} left={<IconTile tone={color.trust}><Text style={{ fontFamily: font.heavy, fontSize: 18, color: color.onAccent }}>?</Text></IconTile>} />
          </Group>

          <Group label={S.about}>
            <Row testID="settings-whats-new" title={wn.title} onPress={() => navigation.navigate('WhatsNew')} />
            <Row title={tx.prefs.privacy} onPress={() => Linking.openURL('https://thirstr.fun/privacy/')} />
            <Row title={tx.prefs.licenses} onPress={() => setLic(!lic)} />
            {lic ? <Text style={{ ...type.meta, color: color.fgSecondary, padding: space.l }}>{tx.prefs.licensesBody}</Text> : null}
            <Row title={S.version} value={app.expo.version} />
          </Group>

          <Pressable
            testID="logout"
            accessibilityRole="button"
            onPress={async () => {
              setErr(null);
              await api('POST', '/auth/logout').catch(() => {});
              await clearSession();
              signOut();
            }}
            style={({ pressed }) => ({ height: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? color.bgRaised : 'transparent' })}
          >
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{S.logout}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function EyeIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.onAccent} strokeWidth={2.2}>
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}

function BellIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.onAccent} strokeWidth={2.2} strokeLinecap="round">
      <Path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <Path d="M10 21h4" />
    </Svg>
  );
}

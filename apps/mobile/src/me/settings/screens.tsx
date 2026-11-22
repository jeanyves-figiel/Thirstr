import { mod } from '../../i18n/mod';
import { mx as momentsTx } from '../../i18n/moments';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { api, ApiError, clearSession, Me } from '../../api/client';
import { useSession } from '../../app/session';
import { askPushPermission } from '../../chat/engine';
import { customQuickReplies, setCustomQuickReplies } from '../../chat/quick';
import * as Recent from '../../chat/recent';
import { mx } from '../../i18n/media';
import { lx } from '../../i18n/links';
import { toast } from '../../ui/Toast';
import { LocationSheet } from '../../explore/LocationSheet';
import { langName, targetLang, translateAvailable } from '../../chat/translate';
import { rx } from '../../i18n/recovery';
import { pkx } from '../../i18n/passkeys';
import { passkeysAvailable } from '../../auth/passkey';
import { Icon } from '../../ui/icons';
import { firstMethod } from '../PasskeysScreen';
import { tx } from '../../i18n/app';
import { tr } from '../../i18n/travel';
import { trx } from '../../i18n/translate';
import { v3 } from '../../i18n/v3';
import { biometrics, biometricsAvailable, getLock } from '../../safety/lock';
import { color, font, radius, space, type } from '../../theme/tokens';
import type { Notice } from '../../trust/NoticesScreen';
import { Button, Field, RangeSlider, Sheet } from '../../ui';
import { ExportCancelled, exportData, ExportProgress, ExportStage } from '../exportData';
import { type Prefs, prefs, setPrefs, type TranslateMode } from '../prefs';
import { SignInEmailSheet } from '../SignInEmail';
import { recoveryRowValue } from '../RecoveryScreen';
import { Group, Page, Row, SegBlock, SwitchRow, useSettings } from './parts';
import { bx } from '../../i18n/backup';
import { useBackupSummary } from './ChatBackupScreen';

type Nav = { navigate: (s: string, p?: object) => void; goBack?: () => void };
const S = v3.settings;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

// S-67 Privacy & visibility (F-17 R-17.7, R-17.11; F-05 R-05.6).
export function PrivacySettings() {
  const { me, setMe } = useSession();
  const { st, put, err, setErr } = useSettings();
  const [loc, setLoc] = useState(false);
  const [ageDraft, setAgeDraft] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!ageDraft) return;
    const t = setTimeout(() => put({ hide_from_age_min: ageDraft[0] === 18 ? null : ageDraft[0], hide_from_age_max: ageDraft[1] === 99 ? null : ageDraft[1] }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageDraft]);
  if (!st) return <Page title={S.privacy} loading />;
  const age: [number, number] = ageDraft ?? [st.hide_from_age_min ?? 18, st.hide_from_age_max ?? 99];
  const level = me.location?.level ?? 'city';
  const surfaces = [
    ['grid', 'show_in_grid'],
    ['map', 'show_in_map'],
    ['tonight', 'show_in_tonight'],
    ['activities', 'show_in_activities'],
    ['venues', 'show_in_venues'],
  ] as const;
  return (
    <Page title={S.privacy} err={err}>
      <Group>
        <Row testID="privacy-location" title={tx.me.location} sub={S.locationRow} value={tx.location.levels[level]?.[0]} valueTone={color.trust} onPress={() => setLoc(true)} />
      </Group>
      <Group label={S.whoSees}>
        <SwitchRow title={S.hideUnverified} sub={S.hideUnverifiedSub} value={st.hide_from_unverified} onChange={(v) => put({ hide_from_unverified: v })} />
        <SwitchRow title={S.hideNew} sub={S.hideNewSub} value={st.hide_from_new} onChange={(v) => put({ hide_from_new: v })} />
        <SwitchRow title={tr.showToRemote} sub={tr.showToRemoteSub} value={st.show_to_remote !== false} onChange={(v) => put({ show_to_remote: v })} />
        <SwitchRow
          title={S.hideHidden}
          sub={S.hideHiddenSub}
          value={!!me.location?.hide_from_hidden}
          onChange={(v) => api<Me>('PATCH', '/me/visibility', { hide_from_hidden: v }).then(setMe, (e) => setErr(e instanceof ApiError ? e.message : tx.common.error))}
        />
        <View style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
          <RangeSlider label={S.ages} fill={color.trust} min={18} max={99} low={age[0]} high={age[1]} format={(v) => (v === 99 ? '99+' : String(v))} onChange={(lo, hi) => setAgeDraft([lo, hi])} />
        </View>
      </Group>
      <View style={{ gap: space.s }}>
        <Text style={label}>{S.appearOn}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {surfaces.map(([k, f]) => {
            const on = st[f];
            return (
              <Pressable
                key={k}
                testID={`appear-${k}`}
                accessibilityRole="switch"
                accessibilityLabel={`${S.appearOn} ${S.surfaces[k]}`}
                accessibilityState={{ checked: on }}
                onPress={() => put({ [f]: !on })}
                style={{ height: 40, paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1.5, borderColor: on ? color.trust : color.line, backgroundColor: on ? `${color.trust}24` : 'transparent', justifyContent: 'center' }}
              >
                <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 14, color: on ? color.fgPrimary : color.fgMuted }}>{S.surfaces[k]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{S.appearHint}</Text>
      </View>
      <Group label={S.whatSee}>
        <SegBlock testID="distance" title={S.distance} value={st.show_distance} options={(['exact', 'range', 'none'] as const).map((k) => [k, S.distOpts[k]])} onChange={(v) => put({ show_distance: v })} caption={S.distSub[st.show_distance]} />
        <SwitchRow title={S.online} sub={S.onlineSub} value={st.online_visible} onChange={(v) => put({ online_visible: v })} />
        {/* F-21 R-21.17 (#212, D-21b C) */}
        <SwitchRow title={momentsTx.quietTitle} sub={momentsTx.quietSub} value={st.moments_quiet === true} onChange={(v) => put({ moments_quiet: v })} />
      </Group>
      <LocationSheet visible={loc} onClose={() => setLoc(false)} />
    </Page>
  );
}

// S-68 Chats & media (R-17.6, R-17.5, R-17.5b translation).
export function ChatSettings({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const backup = useBackupSummary();
  const { st, put, err } = useSettings();
  const [pf, setPf] = useState<Prefs>(prefs());
  const [quick, setQuick] = useState<string[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [recentN, setRecentN] = useState(0);
  useEffect(() => {
    customQuickReplies().then(setQuick);
    const load = () => Recent.list().then((l) => setRecentN(l.length));
    load();
    return Recent.onRecent(load);
  }, []);
  if (!st) return <Page title={S.chats} loading />;
  const tone = color.friends;
  return (
    <Page title={S.chats} err={err}>
      <Group label={S.whoMessage}>
        {(['verified', 'tapped', 'filters'] as const).map((k) => {
          const on = st.who_can_message === k;
          return (
            <Pressable key={k} testID={`who-${k}`} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={S.whoOpts[k][0]} onPress={() => put({ who_can_message: k })} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingHorizontal: space.l }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={rowTitle}>{S.whoOpts[k][0]}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{S.whoOpts[k][1]}</Text>
              </View>
              <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? tone : color.line, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tone }} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Group>
      <Group label={S.media}>
        <SegBlock testID="explicit" tone={tone} title={S.explicit} value={st.explicit_from_strangers} options={(['blur', 'allow', 'block'] as const).map((k) => [k, S.explicitOpts[k]])} onChange={(v) => put({ explicit_from_strangers: v })} />
        <SegBlock testID="adult-links" tone={tone} title={lx.adultPreviews} caption={lx.adultPreviewsSub} value={pf.adultLinkPreviews ?? 'blur'} options={(['blur', 'show', 'none'] as const).map((k) => [k, lx.adultOpts[k]])} onChange={(v) => setPrefs({ adultLinkPreviews: v }).then(setPf)} />
        <SwitchRow tone={tone} title={tx.prefs.autoDelete} value={pf.autoDelete || !!me.safe_mode_active} disabled={!!me.safe_mode_active} onChange={(v) => setPrefs({ autoDelete: v }).then(setPf)} />
        <Row
          testID="clear-recent"
          title={mx.clearRecent}
          sub={mx.clearRecentSub}
          value={recentN ? String(recentN) : undefined}
          onPress={() => Recent.clear().then(() => toast(mx.cleared))}
        />
      </Group>
      <Group>
        <Row testID="chat-backup" title={bx.title} value={backup} onPress={() => navigation.navigate('ChatBackupSettings')} />
      </Group>
      <Group label={S.messages}>
        <SegBlock testID="disappear" tone={tone} title={S.disappear} value={st.disappearing_default} options={(['24h', '7d', 'never'] as const).map((k) => [k, S.disOpts[k]])} onChange={(v) => put({ disappearing_default: v })} />
        <SwitchRow tone={tone} title={S.receipts} sub={tx.settings.receiptsSub} value={st.read_receipts} onChange={(v) => put({ read_receipts: v })} />
        <Row title={S.quick} sub={S.quickSub} value={S.quickCount(quick.filter((x) => x?.trim()).length)} onPress={() => setQuickOpen(true)} />
      </Group>
      <Group label={trx.section}>
        <SegBlock
          testID="translate"
          tone={tone}
          title={trx.setting}
          value={pf.translate}
          options={(['auto', 'tap', 'off'] as TranslateMode[]).map((k) => [k, trx.modes[k]])}
          onChange={(v) => setPrefs({ translate: v }).then(setPf)}
          caption={translateAvailable() ? `${trx.into(langName(targetLang()))}. ${trx.modeSub[pf.translate]}` : trx.unavailable}
        />
        <View style={{ flexDirection: 'row', gap: space.m, marginHorizontal: space.l, marginBottom: space.l, padding: space.m, borderRadius: 16, backgroundColor: `${color.trust}1F` }}>
          <Text style={{ ...type.meta, color: color.fgSoft, flex: 1 }}>{trx.privacy}</Text>
        </View>
      </Group>
      <Sheet visible={quickOpen} onClose={() => { setCustomQuickReplies(quick); setQuickOpen(false); }} title={S.quick} closeLabel={tx.common.done}>
        <Text style={{ ...type.meta, color: color.fgMuted }}>{tx.settings.quickHint}</Text>
        {[0, 1, 2].map((i) => (
          <Field
            key={i}
            label={`${S.quick} ${i + 1}`}
            placeholder={tx.chat.quick[i]}
            maxLength={40}
            value={quick[i] ?? ''}
            onChangeText={(v) => {
              const next = [...quick];
              next[i] = v;
              setQuick(next);
            }}
            onEndEditing={() => setCustomQuickReplies(quick)}
          />
        ))}
      </Sheet>
    </Page>
  );
}

// Push keys per visible switch (F-16). Moderation notices are always on.
const PUSH: Record<string, Record<string, string[]>> = {
  chats: { message: ['message'], tap: ['tap'], mutual: ['mutual'] },
  plans: { party: ['party_request', 'party_accepted', 'address'], tonight_match: ['tonight_match'], activity: ['activity_join', 'club_event'], venue_tap: ['venue_tap'] },
  account: { verification: ['verification'] },
};

// S-69 Notifications (F-16, F-17).
export function NotificationSettings() {
  const { st, put, err } = useSettings();
  const [pick, setPick] = useState<'from' | 'to' | null>(null);
  if (!st) return <Page title={S.notifications} loading />;
  const tone = color.hookup;
  const push = st.push ?? {};
  const qh = st.quiet_hours;
  const tz = () => -new Date().getTimezoneOffset();
  return (
    <Page title={S.notifications} err={err}>
      <View style={{ flexDirection: 'row', gap: space.m, padding: space.l, borderRadius: 18, backgroundColor: `${color.trust}1F` }}>
        <Text style={{ ...type.meta, color: color.fgSoft, flex: 1 }}>{S.pushNote}</Text>
      </View>
      {Platform.OS === 'ios' ? (
        <Group>
          <Row title={tx.settings.enablePush} onPress={() => askPushPermission()} />
        </Group>
      ) : null}
      {Object.entries(PUSH).map(([g, items]) => (
        <Group key={g} label={S.groups[g]}>
          {Object.entries(items).map(([k, keys]) => (
            <SwitchRow key={k} testID={`push-${k}`} tone={tone} title={S.push[k]} value={keys.every((x) => push[x] !== false)} onChange={(v) => put({ push: { ...push, ...Object.fromEntries(keys.map((x) => [x, v])) } })} />
          ))}
        </Group>
      ))}
      <Group label={S.quiet}>
        <SwitchRow tone={tone} title={S.quiet} sub={S.quietSub} value={!!qh} onChange={(v) => put({ quiet_hours: v ? { from: 23, to: 7, tz_offset_min: tz() } : null })} />
        {qh ? (
          <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingBottom: space.l }}>
            {(['from', 'to'] as const).map((k) => (
              <Pressable key={k} testID={`quiet-${k}`} accessibilityRole="button" accessibilityLabel={`${k === 'from' ? S.from : S.until} ${hh(qh[k])}`} onPress={() => setPick(k)} style={{ flex: 1, height: 60, borderRadius: 16, backgroundColor: color.bgBase, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{k === 'from' ? S.from : S.until}</Text>
                <Text style={{ ...type.title, fontSize: 20, color: color.fgPrimary }}>{hh(qh[k])}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Group>
      <Sheet visible={!!pick && !!qh} onClose={() => setPick(null)} title={pick === 'from' ? S.from : S.until} closeLabel={tx.common.close}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {Array.from({ length: 24 }, (_, h) => {
            const on = !!qh && !!pick && qh[pick] === h;
            return (
              <Pressable
                key={h}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  if (qh && pick) put({ quiet_hours: { ...qh, [pick]: h, tz_offset_min: tz() } });
                  setPick(null);
                }}
                style={{ width: '15%', flexGrow: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? tone : color.bgOverlay }}
              >
                <Text style={{ ...type.meta, fontFamily: font.bold, color: on ? color.onAccent : color.fgPrimary }}>{hh(h)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </Page>
  );
}

// S-70 Safety settings (F-14, F-13, F-03, F-15).
export function SafetySettings({ navigation }: { navigation: Nav }) {
  const { me, setMe } = useSession();
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [lock, setLock] = useState(false);
  useFocusEffect(
    useCallback(() => {
      Promise.all([api<{ blocks: unknown[] }>('GET', '/me/blocks'), api<{ hidden: unknown[] }>('GET', '/me/hidden')]).then(([b, h]) => setBlocked(b.blocks.length + h.hidden.length), () => {});
      api<{ notices: Notice[] }>('GET', '/me/notices').then((r) => setNotices(r.notices), () => {});
      getLock().then((l) => setLock(!!l), () => {});
    }, []),
  );
  const safe = (setting: string) =>
    api<Me>('PUT', '/me/safe_mode', { setting, active: setting === 'on' }).then(setMe, (e) => setErr(e instanceof ApiError ? e.message : tx.common.error));
  const mode = (me.safe_mode ?? 'auto') as 'auto' | 'on' | 'off';
  const unseen = notices?.filter((n) => !n.seen).length ?? 0;
  return (
    <Page title={S.safety} err={err}>
      <Group>
        <SegBlock
          testID="safe-mode"
          tone={color.sport}
          title={S.safeMode}
          value={mode}
          options={(['auto', 'on', 'off'] as const).map((k) => [k, S.safeOpts[k]])}
          onChange={(v) => (v === 'off' ? setAsk(true) : (setAsk(false), safe(v)))}
          caption={S.safeSub[mode]}
        />
        {ask ? (
          <View style={{ margin: space.l, marginTop: 0, padding: space.m, gap: space.m, borderRadius: 14, backgroundColor: `${color.danger}24` }}>
            <Text style={{ ...type.meta, color: color.fgPrimary }}>{S.safeOffAsk}</Text>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <View style={{ flex: 1 }}>
                <Button small kind="secondary" title={S.keepIt} onPress={() => setAsk(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button testID="safe-off-confirm" small kind="danger" title={S.turnOff} onPress={() => { setAsk(false); safe('off'); }} />
              </View>
            </View>
          </View>
        ) : null}
      </Group>
      <Group hint={S.checkinHint}>
        <Row testID="settings-applock" title={S.appLock} sub={S.appLockSub} value={lock ? v3.settings.sum.on : v3.me.off} onPress={() => navigation.navigate('AppLock')} />
        <Row title={tx.prefs.verification} sub={me.verified ? tx.prefs.verified(me.verified_since ? new Date(me.verified_since).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '') : tx.prefs.notVerified} value={me.verified ? tx.prefs.reverify : undefined} onPress={() => navigation.navigate('Verify')} />
        <Row testID="settings-blocked" title={mod.list.row} value={blocked != null ? String(blocked) : undefined} onPress={() => navigation.navigate('Blocked')} />
        <Row testID="settings-notices" title={S.notices} sub={S.noticesSub} value={unseen ? String(unseen) : notices?.length ? undefined : S.none} onPress={() => navigation.navigate('Notices')} />
      </Group>
    </Page>
  );
}

// S-64 Account (F-01, R-17.13).
export function AccountSettings({ navigation }: { navigation: Nav }) {
  const { me, setMe, signOut } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const [emailSheet, setEmailSheet] = useState(false);
  const [exported, setExported] = useState(false);
  const [packing, setPacking] = useState<Partial<Record<ExportStage, ExportProgress>> | null>(null);
  const cancelExport = React.useRef(false);
  const [devices, setDevices] = useState<number | null>(null);
  const [recovery, setRecovery] = useState<{ on: boolean; since: string | null; backup_at: string | null } | null>(null);
  useFocusEffect(
    useCallback(() => {
      api<{ devices: unknown[] }>('GET', '/me/devices').then((r) => setDevices(r.devices.length), () => {});
      api<{ on: boolean; since: string | null; backup_at: string | null }>('GET', '/me/recovery').then(setRecovery, () => {});
    }, []),
  );
  const call = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    }
  };
  const paused = me.status === 'paused';
  return (
    <Page title={S.account} err={err}>
      <Group label={S.signIn}>
        {passkeysAvailable() ? (
          <Row testID="settings-passkeys" left={<Icon.Key size={20} c={color.trust} />} title={pkx.row} sub={pkx.rowSub} value={me.passkey_count ? String(me.passkey_count) : pkx.add} valueTone={me.passkey_count ? undefined : color.trust} onPress={() => navigation.navigate('Passkeys')} />
        ) : null}
        <Row testID="settings-email" title={tx.signInEmail.row} sub={me.has_email ? undefined : tx.signInEmail.rowSub} value={me.has_email ? tx.signInEmail.added : undefined} valueTone={me.has_email ? color.trust : undefined} onPress={me.has_email ? undefined : () => setEmailSheet(true)} />
        <Row testID="settings-recovery" title={rx.row} sub={recovery?.on ? undefined : rx.rowSub} value={recoveryRowValue(recovery)} valueTone={recovery?.on ? color.trust : undefined} onPress={() => navigation.navigate('Recovery')} />
        <Row testID="settings-devices" title={tx.devices.title} sub={S.devicesSub} value={devices != null ? String(devices) : undefined} onPress={() => navigation.navigate('Devices')} />
      </Group>
      <Group label={pkx.signedInWith}>
        <Row testID="settings-first-method" title={firstMethod(me)} sub={pkx.firstMethod} value="✓" valueTone={color.trust} />
      </Group>
      <Group label={S.yourData}>
        <Row testID="settings-export" title={tx.exportData.title} sub={exported ? tx.exportData.ready : S.exportSub} chevron={false} onPress={packing ? undefined : async () => {
            setErr(null);
            cancelExport.current = false;
            setPacking({});
            try {
              await exportData((p) => setPacking((x) => (x ? { ...x, [p.stage]: p } : x)), () => cancelExport.current);
              setExported(true);
            } catch (e) {
              if (!(e instanceof ExportCancelled)) setErr(tx.exportData.failed);
            } finally {
              setPacking(null);
            }
          }} />
      </Group>
      <Group label={S.leave}>
        <Row testID="settings-pause" title={paused ? S.resume : S.pause} sub={paused ? S.resumeSub : S.pauseSub} chevron={false} onPress={() => call(async () => setMe(await api<Me>('POST', paused ? '/account/resume' : '/account/pause')))} />
        <Row title={S.logoutAll} sub={S.logoutAllSub} chevron={false} onPress={() => call(async () => { await api('POST', '/auth/logout_all'); await clearSession(); signOut(); })} />
        <Row testID="settings-delete" title={S.delete} sub={S.deleteSub} danger onPress={() => navigation.navigate('DeleteAccount')} />
      </Group>
      <SignInEmailSheet visible={emailSheet} onClose={() => setEmailSheet(false)} />
      <ExportSheet progress={packing} onCancel={() => (cancelExport.current = true)} />
    </Page>
  );
}

// R-01.11 "Packing your data" (#25): live per-stage counts while the phone builds the .zip.
function ExportSheet({ progress, onCancel }: { progress: Partial<Record<ExportStage, ExportProgress>> | null; onCancel: () => void }) {
  const E = tx.exportData;
  const stages: Exclude<ExportStage, 'zip'>[] = ['account', 'photos', 'albums', 'chats'];
  const p = progress ?? {};
  const weight = { account: 0.1, photos: 0.25, albums: 0.5, chats: 0.15 };
  const frac = stages.reduce((n, k) => n + (p[k]?.total ? (p[k]!.done / p[k]!.total) * weight[k] : 0), 0);
  return (
    <Sheet visible={progress != null} onClose={onCancel} title={E.packing} closeLabel={E.cancel}>
      <View testID="export-sheet" style={{ gap: space.m, paddingBottom: space.xl }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: color.bgBase, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
          <View style={{ height: 8, borderRadius: 4, width: `${Math.max(4, Math.round(frac * 100))}%`, backgroundColor: color.trust }} />
        </View>
        {stages.map((k) => {
          const s = p[k];
          const done = s && s.done >= s.total;
          return (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...type.body, color: color.fgSecondary }}>{E.stages[k]}</Text>
              <Text style={{ ...type.body, fontFamily: font.bold, color: s ? color.fgPrimary : color.fgMuted, fontVariant: ['tabular-nums'] }}>{!s ? '–' : k === 'account' ? (done ? '✓' : '…') : `${s.done} / ${s.total}`}</Text>
            </View>
          );
        })}
        <Text style={{ ...type.caption, color: color.fgMuted }}>{E.stays}</Text>
      </View>
    </Sheet>
  );
}

// Delete account confirm (R-17.8): biometrics when the phone has them, then type DELETE.
export function DeleteAccount() {
  const { signOut } = useSession();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      if ((await biometricsAvailable().catch(() => false)) && !(await biometrics(S.deleteTitle))) return;
      await api('DELETE', '/account', { confirm: 'DELETE' });
      await clearSession();
      signOut();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title={S.deleteTitle} err={err}>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{S.deleteBody}</Text>
      <Field testID="delete-confirm" label={S.deleteType} value={text} onChangeText={setText} autoCapitalize="characters" autoCorrect={false} />
      <Button testID="delete-go" kind="danger" title={S.delete} busy={busy} disabled={text.trim() !== 'DELETE'} onPress={go} />
    </Page>
  );
}

const label = { ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' as const, color: color.fgMuted, marginHorizontal: space.xs };
const rowTitle = { ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary };

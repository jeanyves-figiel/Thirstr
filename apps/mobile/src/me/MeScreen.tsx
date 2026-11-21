import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { api, ApiError } from '../api/client';
import type { Mode, MyProfile, Trip } from '../api/types';
import { useSession } from '../app/session';
import { listAlbums, onAlbums } from '../chat/albums';
import { type Level } from '../explore/level';
import { LocationSheet } from '../explore/LocationSheet';
import { tx } from '../i18n/app';
import { v3 } from '../i18n/v3';
import { LENSES } from '../profile/lens';
import { contacts } from '../safety/safety';
import { color, font, modeColor, radius, space, touch, type } from '../theme/tokens';
import type { Notice } from '../trust/NoticesScreen';
import { afterSheet, Banner, Button, ErrorText, Icon, Photo, Sheet, VerifiedTick } from '../ui';
import { loadTrips, Plane, rangeLabel } from '../travel/travel';
import { pe } from '../i18n/profileEdit';
import { quickWins } from '../profile/quickWins';
import { tr } from '../i18n/travel';
import { mx } from '../i18n/moments';
import * as Moments from '../moments/api';
import { RingAvatar } from '../moments/Ring';
import { NowSheet } from './NowSheet';
import { prefs, setPrefs } from './prefs';
import { Qr } from './Qr';
import { SignInEmailSheet } from './SignInEmail';

type Nav = { navigate: (s: string, p?: object) => void };
// Accounts from before one-profile-three-lenses (D-15, #96) get a one-time notice.
const LENSES_SHIPPED = Date.parse('2026-11-19T00:00:00Z');

// S-60 Me v3 (#102): profile card, "How you show up right now" (location incl. Hidden panel #114, Now),
// "Show me in" lens tiles, Yours (albums, date check-in). Settings behind the gear.
export function MeScreen({ navigation }: { navigation: Nav }) {
  const { me, refresh, setMode } = useSession();
  const insets = useSafeAreaInsets();
  const p: MyProfile | undefined = me.profile ?? me.profiles?.[0];
  const showIn: Mode[] = p?.show_in ?? ['hookup'];
  const [lensNote, setLensNote] = useState(false);
  const [mergedDone, setMergedDone] = useState(!!prefs().lensNoticeDone);
  const merged = !mergedDone && !!me.created_at && Date.parse(me.created_at) < LENSES_SHIPPED;
  const [now, setNow] = useState(false);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailSheet, setEmailSheet] = useState(false);
  const [nudgeDone, setNudgeDone] = useState(!!prefs().emailNudgeDone);
  const [openedAt] = useState(() => Date.now());
  const weekOld = !!me.created_at && openedAt - new Date(me.created_at).getTime() > 7 * 86400000;
  const emailNudge = weekOld && me.has_email === false && !nudgeDone;
  const [err, setErr] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [albums, setAlbums] = useState(0);
  const [trusted, setTrusted] = useState(0);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loc, setLoc] = useState(false);
  const [moments, setMoments] = useState(0);

  useEffect(() => {
    api<{ notices: Notice[] }>('GET', '/me/notices').then((r) => setNotices(r.notices), () => {});
    const a = () => listAlbums().then((l) => setAlbums(l.length), () => {});
    a();
    return onAlbums(a);
  }, []);
  useFocusEffect(
    useCallback(() => {
      contacts().then((c) => setTrusted(c.filter((x) => x.accepted).length), () => {});
      loadTrips().then((r) => setTrips(r.trips), () => {});
      if (me.verified) Moments.mine().then((l) => setMoments(Moments.alive(l).length), () => {});
    }, [me.verified]),
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  // R-06.1a: at least one lens stays on. Turning Sport on without sports opens the sport fields.
  const setLens = (m: Mode) => {
    if (!p || busy) return;
    const on = !showIn.includes(m);
    const next = on ? LENSES.filter((x) => x === m || showIn.includes(x)) : showIn.filter((x) => x !== m);
    if (next.length === 0) return setLensNote(true);
    setLensNote(false);
    if (on) setMode(m);
    run(async () => {
      await api('PATCH', `/me/profiles/${p.id}`, { show_in: next });
      const sports = p.fields.sports;
      if (m === 'sport' && on && !(Array.isArray(sports) && sports.length)) navigation.navigate('EditSection', { id: p.id, section: 'sport' });
    });
  };

  // #190: LocationControl applies every tap; Exact options sit inline (no sheet, no Save).
  const level = (me.location?.level ?? 'city') as Level;

  // One banner slot, highest priority only (S-60).
  const suspended = me.status === 'suspended' ? notices.find((n) => n.action === 'suspend' && n.ends_at) : undefined;
  const banner = suspended ? (
    <Banner tone="danger" text={tx.notices.suspended(new Date(suspended.ends_at!).toLocaleDateString())} onPress={() => navigation.navigate('Notices')} />
  ) : notices.some((n) => !n.seen) ? (
    <Banner tone="warn" text={tx.notices.banner} onPress={() => navigation.navigate('Notices')} />
  ) : !me.verified ? (
    <Banner text={tx.explore.verifyBanner} onPress={() => navigation.navigate('Verify')} />
  ) : emailNudge ? (
    <Banner
      testID="email-nudge"
      tone="personal"
      text={tx.signInEmail.nudge}
      onPress={() => {
        setEmailSheet(true);
        setNudgeDone(true);
        setPrefs({ emailNudgeDone: true });
      }}
    />
  ) : me.status === 'paused' ? (
    <Banner tone="warn" text={tx.me.paused} onPress={() => navigation.navigate('AccountSettings')} />
  ) : merged ? (
    <Banner tone="personal" text={tx.me.mergedNotice} onPress={() => { setMergedDone(true); setPrefs({ lensNoticeDone: true }); }} />
  ) : null;

  const main = p?.photos.find((x) => x.slot === 0);
  const photoCount = p?.photos.filter((x) => x.url && x.status !== 'rejected').length ?? 0;
  const accent = modeColor.hookup;
  const precise = level === 'area' && !!me.location?.precise;
  const others = precise ? `${tx.location.othersSee}: ~150 m` : v3.me.othersSee[level];
  const levelName = tx.location.levels[level]?.[0] ?? level;
  const pinLive = !!me.location?.pin;
  const nextTrip = [...trips].sort((a, b) => a.first_day.localeCompare(b.first_day))[0];
  const complete = !!p && p.completeness >= 100;
  const wins = p ? quickWins({ ...p.fields }, photoCount, showIn).length : 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.l, paddingTop: insets.top + space.s, gap: space.xl, paddingBottom: 140, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, color: color.fgPrimary }}>
            {tx.me.title}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {p ? <RoundBtn testID="me-qr" label={v3.me.qr} onPress={() => setQr(true)} icon={<QrIcon />} /> : null}
            <RoundBtn testID="me-settings" label={v3.settings.title} onPress={() => navigation.navigate('Settings')} icon={<GearIcon />} />
          </View>
        </View>

        {banner}

        {p ? (
          <View style={{ padding: space.l, borderRadius: radius.tray, backgroundColor: color.bgRaised, gap: space.l }}>
            <View style={{ flexDirection: 'row', gap: space.l, alignItems: 'center' }}>
              <View style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
                <Ring pct={p.completeness} c={accent} size={72} />
                <Photo uri={main?.url} id={p.id} label={p.display_name} style={{ position: 'absolute', width: 58, height: 58, borderRadius: 29 }} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <Text style={{ ...type.title, fontSize: 20, color: color.fgPrimary, flexShrink: 1 }} numberOfLines={1}>
                    {p.display_name}, {p.age}
                  </Text>
                  {me.verified ? <VerifiedTick size={18} /> : null}
                </View>
                <Text testID="me-completeness" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p.completeness }} style={{ ...type.meta, fontFamily: font.bold, color: complete ? color.trust : color.alertIcon }}>
                  {complete ? pe.complete : `${pe.profilePct(p.completeness)} · ${pe.winsLeft(wins)}`}
                </Text>
              </View>
            </View>
            {/* #124: buttons size to their label so long labels stay on one line on small phones. */}
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <View style={{ flexGrow: 1, flexBasis: 'auto' }}>
                <Button testID="edit-profile" small title={complete ? pe.edit : pe.finish} fill={color.fgPrimary} onPress={() => navigation.navigate('EditProfile', { id: p.id })} />
              </View>
              <View style={{ flexGrow: 0, flexBasis: 'auto' }}>
                <Button testID="me-preview" small kind="secondary" title={pe.preview} onPress={() => navigation.navigate('LensPreview')} />
              </View>
            </View>
          </View>
        ) : null}

        {/* #219: Right now = 3 rows; the level control lives in the Location sheet (S-30). */}
        <View style={{ gap: space.s }}>
          <GroupLabel tone={color.trust}>{pe.rightNow}</GroupLabel>
          <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
            <Row testID="me-location" onPress={() => setLoc(true)} label={`${tx.me.location}: ${levelName}`} first>
              <IconTile tone={color.trust}>
                <Icon.Pin size={18} c={color.trust} />
              </IconTile>
              <View style={{ flex: 1 }}>
                <Text style={rowTitle}>{tx.me.location}</Text>
                <Text testID="me-others-see" style={rowSub} numberOfLines={1}>
                  {others}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: color.trust }}>
                {pinLive ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.hookup }} /> : null}
                <Text style={{ ...type.caption, fontSize: 13, color: color.onAccent }}>{levelName}</Text>
              </View>
              <Icon.Next />
            </Row>
            <Row testID="me-now" onPress={() => setNow(true)} label={tx.me.now}>
              <IconTile tone={color.hookup}>
                <Icon.Bolt size={18} c={color.hookup} />
              </IconTile>
              <View style={{ flex: 1 }}>
                <Text style={rowTitle}>{tx.me.now}</Text>
                <Text style={rowSub} numberOfLines={1}>{v3.me.nowSub}</Text>
              </View>
              <Text style={rowValue}>{me.now ? tx.now[me.now.status] : v3.me.off}</Text>
              <Icon.Next />
            </Row>
            {/* F-20 R-20.1 */}
            <Row testID="me-trips" onPress={() => navigation.navigate('Trips')} label={tr.trips}>
              <IconTile tone={color.travel}>
                <Plane size={18} c={color.travel} />
              </IconTile>
              <View style={{ flex: 1 }}>
                <Text style={rowTitle}>{tr.trips}</Text>
                <Text style={rowSub} numberOfLines={1}>{nextTrip ? `${nextTrip.city.name} · ${rangeLabel(nextTrip.first_day, nextTrip.last_day)}` : tr.rowSub}</Text>
              </View>
              {trips.length ? <Text style={rowValue}>{trips.length}</Text> : null}
              <Icon.Next />
            </Row>
            {/* F-21 R-21.14 (#212): Moments, live count; tap = own viewer, or post the first one */}
            <Row
              testID="me-moments"
              onPress={() =>
                moments > 0
                  ? navigation.navigate('Moments', { queue: [{ id: p?.id ?? 'me', name: p?.display_name ?? '', age: p?.age ?? 0, photo: null }], index: 0, mode: 'hookup', self: true })
                  : navigation.navigate(me.verified ? 'MomentNew' : 'Verify')
              }
              label={mx.meRow}
            >
              <RingAvatar size={36} unseen={moments > 0}>
                <Photo uri={p?.photos.find((x) => x.slot === 0)?.thumb_url ?? p?.photos.find((x) => x.slot === 0)?.url} id={p?.id ?? 'me'} label="" style={{ width: '100%', height: '100%' }} />
              </RingAvatar>
              <View style={{ flex: 1 }}>
                <Text style={rowTitle}>{mx.meRow}</Text>
                <Text style={rowSub}>{mx.live(moments)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={mx.addA11y} onPress={() => navigation.navigate(me.verified ? 'MomentNew' : 'Verify')} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center' }}>
                <Icon.Plus size={18} c={color.onAccent} />
              </Pressable>
            </Row>
          </View>
        </View>

        {p ? (
          <View style={{ gap: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <GroupLabel>{tx.me.showMeIn}</GroupLabel>
              <Pressable testID="me-see-how" accessibilityRole="link" onPress={() => navigation.navigate('LensPreview')} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }}>
                <Text style={{ ...type.meta, fontFamily: font.bold, color: color.trust }}>{pe.howILook}</Text>
                <Icon.Next c={color.trust} size={13} />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              {LENSES.map((m) => {
                const on = showIn.includes(m);
                const c = modeColor[m];
                return (
                  <Pressable
                    key={m}
                    testID={`lens-${m}`}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on, disabled: busy }}
                    accessibilityLabel={`${tx.me.showMeIn} ${tx.modes[m]}`}
                    onPress={() => setLens(m)}
                    style={({ pressed }) => ({ flex: 1, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.s, borderRadius: radius.pill, borderWidth: 2, borderColor: on ? c : color.line, backgroundColor: on ? `${c}26` : color.bgRaised, opacity: pressed ? 0.85 : 1 })}
                  >
                    {/* On: the lens dot becomes a check in the lens colour. */}
                    <View style={{ width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c : 'transparent' }}>
                      {on ? <Icon.Check size={11} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} />}
                    </View>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary, flexShrink: 1 }}>
                      {tx.modes[m]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {lensNote ? <Text style={{ ...type.meta, color: color.personal }}>{tx.me.lensLastOne}</Text> : null}
          </View>
        ) : null}

        <View style={{ gap: space.s }}>
          <GroupLabel>{v3.me.yours}</GroupLabel>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Tile testID="me-albums" onPress={() => navigation.navigate('Albums')} icon={<Icon.Lock size={20} c={color.fgPrimary} />} title={tx.albums.title} sub={pe.albums(albums)} />
            <Tile testID="me-safety" onPress={() => navigation.navigate('Safety')} icon={<Icon.Shield size={20} c={color.fgPrimary} />} title={v3.me.checkin} sub={pe.checkin(trusted)} />
          </View>
        </View>
        <ErrorText text={err} />
      </ScrollView>
      {/* #219: content never shows under the status bar. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: color.bgBase }} />
      <NowSheet visible={now} onClose={() => setNow(false)} />
      <LocationSheet visible={loc} onClose={() => setLoc(false)} onLocked={() => { setLoc(false); navigation.navigate('Verify'); }} />
      <SignInEmailSheet visible={emailSheet} onClose={() => setEmailSheet(false)} />
      {p ? <QrSheet visible={qr} profileId={p.id} onClose={() => setQr(false)} /> : null}
    </View>
  );
}

const rowTitle = { ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary };
const rowSub = { ...type.meta, color: color.fgSecondary };
const rowValue = { ...type.meta, fontSize: 14, color: color.fgSecondary };

export function GroupLabel({ children, tone = color.fgMuted }: { children: React.ReactNode; tone?: string }) {
  return <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: tone, marginHorizontal: space.xs }}>{children}</Text>;
}

export function IconTile({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tone ? `${tone}29` : color.bgOverlay }}>{children}</View>;
}

function Row({ children, onPress, testID, label, first }: { children: React.ReactNode; onPress?: () => void; testID?: string; label?: string; first?: boolean }) {
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.m, minHeight: 60, paddingHorizontal: space.l, paddingVertical: space.s, borderTopWidth: first ? 0 : 1, borderTopColor: color.lineSubtle };
  if (!onPress)
    return (
      <View testID={testID} style={style}>
        {children}
      </View>
    );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [style, pressed && { backgroundColor: color.bgOverlay }]}>
      {children}
    </Pressable>
  );
}

function Tile({ icon, title, sub, onPress, testID }: { icon: React.ReactNode; title: string; sub: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${sub}`}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 104, padding: space.m + 2, gap: space.s, borderRadius: 20, justifyContent: 'space-between', backgroundColor: pressed ? color.bgOverlay : color.bgRaised })}
    >
      {icon}
      <View>
        <Text style={{ ...type.headline, color: color.fgPrimary }}>{title}</Text>
        <Text numberOfLines={1} style={{ ...type.meta, color: color.fgSecondary }}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

function RoundBtn({ icon, label, onPress, testID }: { icon: React.ReactNode; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: touch, height: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? color.bgOverlay : color.bgRaised })}>
      {icon}
    </Pressable>
  );
}

function GearIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.fgPrimary} strokeWidth={2} strokeLinecap="round">
      <Circle cx={12} cy={12} r={3} />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  );
}

function QrIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color.fgPrimary} strokeWidth={2}>
      <Rect x={3} y={3} width={7} height={7} rx={1.5} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} />
      <Path d="M14 14h3v3h-3zM17 20h4v-3" />
    </Svg>
  );
}

// Completeness ring around the main photo (App v2, issue 58).
function Ring({ pct, c, size = 92 }: { pct: number; c: string; size?: number }) {
  const h = size / 2;
  const r = h - 3;
  const len = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={h} cy={h} r={r} stroke={color.line} strokeWidth={4} fill="none" />
      <Circle cx={h} cy={h} r={r} stroke={c} strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}`} transform={`rotate(-90 ${h} ${h})`} />
    </Svg>
  );
}

// I-02 share link as a QR, from the Me header (#102). Creating the link is the same as in Edit profile.
function QrSheet({ visible, profileId, onClose }: { visible: boolean; profileId: string; onClose: () => void }) {
  const [share, setShare] = useState<{ url: string } | null | undefined>(undefined);
  const load = useCallback(() => api<{ share: { url: string } | null }>('GET', `/me/profiles/${profileId}/share`).then((r) => setShare(r.share), () => setShare(null)), [profileId]);
  useEffect(() => {
    if (visible) load();
  }, [visible, load]);
  return (
    <Sheet visible={visible} onClose={onClose} title={tx.share.title} closeLabel={tx.common.close}>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.share.hint}</Text>
      {share ? (
        <View style={{ alignItems: 'center', gap: space.m }}>
          <Qr value={share.url} size={200} />
          <Button
            title={tx.share.send}
            onPress={() => {
              // #124: system share sheet only after this sheet is gone (iOS freeze otherwise).
              onClose();
              afterSheet(() => Share.share({ message: share.url }).catch(() => {}));
            }}
          />
        </View>
      ) : share === null ? (
        <Button kind="secondary" title={tx.share.create} onPress={() => api('POST', `/me/profiles/${profileId}/share`).then(load, () => {})} />
      ) : null}
    </Sheet>
  );
}

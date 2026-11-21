import React, { useEffect, useReducer, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenCapture from 'expo-screen-capture';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import type { Mode } from '../api/types';
import { useSession } from '../app/session';
import { mx } from '../i18n/moments';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon, Photo, Sheet } from '../ui';
import { feel } from '../ui/haptics';
import { toast } from '../ui/Toast';
import * as M from './api';
import type { Moment, MyMoment } from './api';
import { RingAvatar } from './Ring';
import { step, type Item } from './flow';

export type QueueItem = { id: string; name: string; age: number; photo: string | null; where?: string };
type Params = { queue: QueueItem[]; index: number; mode: Mode; self?: boolean };
type Nav = { goBack: () => void; navigate: (r: string, p?: object) => void };

const SHOW_MS = 6000;

// S-77 Moment viewer (F-21 R-21.11–R-21.13, R-21.17–R-21.18). Full screen, no tab bar.
export function MomentViewerScreen({ route, navigation }: { route: { params: Params }; navigation: Nav }) {
  const { queue, mode, self } = route.params;
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [st, dispatch] = useReducer(step, { pi: route.params.index, mi: 0, list: null, done: false, n: queue.length, self: !!self, restart: 0 });
  const [paused, setPaused] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState(false);
  const [seenOpen, setSeenOpen] = useState(false);
  const progress = useSharedValue(0);
  const { pi, mi, list } = st;
  const person = queue[pi];
  const shown = list ? list[mi] : undefined;

  const close = () => {
    M.flushSoon();
    navigation.goBack();
  };
  useEffect(() => {
    if (st.done) {
      M.flushSoon();
      navigation.goBack();
    }
  }, [st.done, navigation]);

  // Load the person's Moments; the reducer starts on the first one not seen yet.
  useEffect(() => {
    let live = true;
    const id = queue[pi].id;
    (self ? M.mine() : M.forProfile(id, mode))
      .then((l) => live && dispatch({ t: 'load', pi, list: M.alive(l) as Item[] }))
      .catch(() => live && dispatch({ t: 'load', pi, list: [] }));
    return () => {
      live = false;
    };
  }, [pi, self, mode, queue]);

  // Progress bar + auto-advance (UI thread); hold, menus and spicy blur pause it.
  const hold = paused || menu || seenOpen;
  const blurred = !!shown && !self && !!(shown as Moment).spicy && me?.settings?.explicit_from_strangers !== 'allow' && !reveal[shown.id];
  const shownId = shown?.id;
  useEffect(() => {
    progress.set(0);
    if (shownId && !self) M.markSeen(shownId, list && mi === list.length - 1 ? person.id : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, st.restart]);
  useEffect(() => {
    if (!shownId || hold || blurred) {
      cancelAnimation(progress);
      return;
    }
    const left = 1 - progress.get();
    progress.set(
      withTiming(1, { duration: SHOW_MS * left, easing: Easing.linear }, (fin) => {
        'worklet';
        if (fin) scheduleOnRN(dispatch, { t: 'next' });
      }),
    );
    return () => cancelAnimation(progress);
  }, [shownId, hold, blurred, progress, st.restart]);
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.get() * 100}%` }));

  // R-21.18: Android blocks capture; iOS tells the poster.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    ScreenCapture.preventScreenCaptureAsync('moments').catch(() => undefined);
    return () => {
      ScreenCapture.allowScreenCaptureAsync('moments').catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'ios' || self || !shownId) return;
    const sub = ScreenCapture.addScreenshotListener(() => M.screenshot(shownId));
    return () => sub.remove();
  }, [shownId, self]);

  // Swipe down closes, swipe left = next person (D-21a B), swipe right = back.
  const pan = usePanGesture({
    activeOffsetY: [-20, 20],
    activeOffsetX: [-20, 20],
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > 110) scheduleOnRN(close);
      else if (e.translationX < -80) scheduleOnRN(dispatch, { t: 'nextPerson' as const });
      else if (e.translationX > 80) scheduleOnRN(dispatch, { t: 'prev' as const });
    },
  });

  const mine = self ? ((shown as MyMoment | undefined) ?? null) : null;

  const removeNow = (m: Item) => {
    // Gone from the screen at once; the server call waits 5 s for Undo (R-21.13).
    dispatch({ t: 'remove', id: m.id });
    let undone = false;
    const timer = setTimeout(() => {
      if (!undone) M.remove(m.id).catch(() => toast(tx.common.retry));
    }, 5000);
    toast(mx.deleted, {
      label: mx.undo,
      on: () => {
        undone = true;
        clearTimeout(timer);
        dispatch({ t: 'restore', m });
      },
    });
  };
  const visible = list ?? [];

  const saveToPhone = async (m: Moment) => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) return;
      const dest = new File(Paths.cache, `moment-${m.id}.jpg`);
      if (dest.exists) dest.delete();
      const f = await File.downloadFileAsync(m.url, dest);
      await MediaLibrary.saveToLibraryAsync(f.uri);
      f.delete();
      toast(mx.saved);
    } catch {
      toast(tx.common.retry);
    }
  };

  const ago = shown ? mx.ago(M.minutesFrom(shown.created_at)) : '';
  const meta = self && shown ? `${mx.aud[(shown as MyMoment).audience]} · ${mx.left(M.minutesLeft(shown.expires_at))}` : [person.where, ago].filter(Boolean).join(' · ');

  return (
    <GestureDetector gesture={pan}>
      <View testID="moment-viewer" style={{ flex: 1, backgroundColor: color.shadow }}>
        {shown ? (
          <Image
            source={{ uri: shown.url }}
            blurRadius={blurred ? 40 : 0}
            resizeMode="cover"
            accessibilityLabel={shown.caption ?? mx.moments}
            style={{ position: 'absolute', width, height }}
          />
        ) : null}
        {/* top scrim for legibility */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 110, backgroundColor: 'rgba(0,0,0,0.28)' }} />

        {/* tap zones: left third back, rest forward; hold pauses */}
        <View style={{ position: 'absolute', top: insets.top + 70, bottom: 110 + insets.bottom, left: 0, right: 0, flexDirection: 'row' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={mx.prev} onPress={() => dispatch({ t: 'prev' })} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={180} style={{ flex: 0.45 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={mx.next} onPress={blurred && shown ? () => setReveal({ ...reveal, [shown.id]: true }) : () => dispatch({ t: 'next' })} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={180} style={{ flex: 1 }} />
        </View>

        {blurred ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: height / 2 - 40, left: 0, right: 0, alignItems: 'center', gap: 6 }}>
            <Icon.EyeOff size={28} />
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{mx.spicy}</Text>
            <Text style={{ ...type.meta, color: color.fgSoft }}>{mx.tapToView}</Text>
          </View>
        ) : null}

        {shown?.caption ? <Caption text={shown.caption} style={shown.caption_style} top={height * 0.58} /> : null}

        {/* progress bars */}
        <View style={{ position: 'absolute', top: insets.top + 6, left: space.m, right: space.m, flexDirection: 'row', gap: 3 }}>
          {visible.map((m, k) => (
            <View key={m.id} style={{ flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
              {k < mi ? <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.95)' }} /> : k === mi ? <Animated.View style={[{ height: '100%', backgroundColor: 'rgba(255,255,255,0.95)' }, barStyle]} /> : null}
            </View>
          ))}
        </View>

        {/* header */}
        <View style={{ position: 'absolute', top: insets.top + 18, left: space.m, right: space.m, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Pressable accessibilityRole="button" accessibilityLabel={person.name} disabled={!!self} onPress={() => navigation.navigate('Profile', { id: person.id, mode })} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flex: 1 }}>
            <RingAvatar size={38} unseen={false} ring={false}>
              <Photo uri={person.photo} id={person.id} label="" style={{ width: '100%', height: '100%' }} />
            </RingAvatar>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>
                {self ? mx.yourMoment : `${person.name}, ${person.age}`}
              </Text>
              <Text numberOfLines={1} style={{ ...type.meta, fontSize: 11.5, color: color.fgSoft }}>
                {meta}
              </Text>
            </View>
          </Pressable>
          {!self ? (
            <Pressable accessibilityRole="button" accessibilityLabel={mx.more} onPress={() => setMenu(true)} hitSlop={8} style={round}>
              <Icon.More />
            </Pressable>
          ) : null}
          <Pressable testID="moment-close" accessibilityRole="button" accessibilityLabel={mx.close} onPress={close} hitSlop={8} style={round}>
            <Icon.Close />
          </Pressable>
        </View>

        {/* footer */}
        {self ? (
          mine ? (
            <View style={{ position: 'absolute', left: space.m, right: space.m, bottom: insets.bottom + space.m, flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
              <Pressable testID="moment-seen" accessibilityRole="button" onPress={() => setSeenOpen(true)} style={{ flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: 'rgba(23,20,46,0.78)', paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{mine.status === 'review' ? mx.checking : mx.seenBy(mine.seen_count)}</Text>
                {mine.tap_count ? <Text style={{ ...type.meta, color: color.fgSoft }}>{mx.taps(mine.tap_count)}</Text> : null}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={mx.save} onPress={() => saveToPhone(mine)} style={roundBig}>
                <Icon.Share />
              </Pressable>
              <Pressable testID="moment-delete" accessibilityRole="button" accessibilityLabel={mx.delete} onPress={() => removeNow(mine)} style={[roundBig, { borderColor: 'rgba(255,77,109,0.6)', borderWidth: 1.5 }]}>
                <Icon.Trash c={color.danger} />
              </Pressable>
            </View>
          ) : null
        ) : (
          <View style={{ position: 'absolute', left: space.m, right: space.m, bottom: insets.bottom + space.m, flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={mx.replyTo(person.name)} onPress={() => navigation.navigate('Chat', { profileId: person.id, name: person.name })} style={{ flex: 1, height: 46, borderRadius: radius.pill, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.55)', paddingHorizontal: space.l, justifyContent: 'center' }}>
              <Text numberOfLines={1} style={{ ...type.meta, color: color.fgSoft }}>
                {mx.replyTo(person.name)}
              </Text>
            </Pressable>
            <Pressable
              testID="moment-fire"
              accessibilityRole="button"
              accessibilityLabel={mx.sendTap}
              onPress={() => {
                if (!shown) return;
                feel('success');
                M.tap(shown.id)
                  .then(() => toast(mx.tapSent))
                  .catch(() => toast(tx.common.retry));
              }}
              style={[roundBig, { backgroundColor: color.hookup }]}
            >
              <Icon.Flame c={color.onAccent} fill={color.onAccent} size={22} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={mx.openChat} onPress={() => navigation.navigate('Chat', { profileId: person.id, name: person.name })} style={roundBig}>
              <Icon.Send c={color.fgPrimary} />
            </Pressable>
          </View>
        )}

        <Sheet visible={menu} onClose={() => setMenu(false)} title={person.name}>
          <MenuRow
            icon={<Icon.Mute />}
            label={mx.mute(person.name)}
            onPress={() => {
              setMenu(false);
              M.mute(person.id, true)
                .then(() => {
                  toast(mx.muted);
                  dispatch({ t: 'nextPerson' });
                })
                .catch(() => toast(tx.common.retry));
            }}
          />
          <MenuRow
            icon={<Icon.Flag c={color.danger} />}
            label={mx.report}
            danger
            onPress={() => {
              setMenu(false);
              navigation.navigate('Report', { profileId: person.id });
            }}
          />
        </Sheet>

        <Sheet visible={seenOpen} onClose={() => setSeenOpen(false)} title={mine ? mx.seenBy(mine.seen_count) : ''}>
          {mine ? <SeenBy m={mine} quietMe={me?.settings?.moments_quiet === true} /> : null}
        </Sheet>
      </View>
    </GestureDetector>
  );
}

const round = { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(23,20,46,0.55)', alignItems: 'center', justifyContent: 'center' } as const;
const roundBig = { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' } as const;

function Caption({ text, style, top }: { text: string; style: M.CaptionStyle; top: number }) {
  const box =
    style === 'pill'
      ? { backgroundColor: color.bgInverse, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 }
      : style === 'pop'
        ? { backgroundColor: color.hookup, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, transform: [{ rotate: '-3deg' }] }
        : { paddingHorizontal: 12 };
  const ink = style === 'clean' ? color.fgPrimary : color.onAccent;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top, left: space.l, right: space.l, alignItems: 'center' }}>
      <View style={box}>
        <Text style={{ fontFamily: font.heavy, fontSize: 18, lineHeight: 23, color: ink, textAlign: 'center', textShadowColor: style === 'clean' ? 'rgba(0,0,0,0.7)' : 'transparent', textShadowRadius: 10 }}>{text}</Text>
      </View>
    </View>
  );
}

export function CaptionPreview(props: { text: string; style: M.CaptionStyle; top: number }) {
  return <Caption {...props} />;
}

function MenuRow({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 52 }}>
      {icon}
      <Text style={{ ...type.headline, fontSize: 15, color: danger ? color.danger : color.fgPrimary }}>{label}</Text>
    </Pressable>
  );
}

// R-21.17 (D-21b C): names, unless the viewer watches quietly; a quiet poster sees counts only.
function SeenBy({ m, quietMe }: { m: MyMoment; quietMe: boolean }) {
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }} contentContainerStyle={{ gap: space.m, paddingBottom: space.l }}>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {[
          [String(m.seen_count), mx.seenBy(m.seen_count).replace(/\s*\d+$/, '')],
          [String(m.tap_count), '🔥 Taps'],
        ].map(([n, l]) => (
          <View key={l} style={{ flex: 1, backgroundColor: color.bgRaised, borderRadius: 16, padding: space.m, alignItems: 'center' }}>
            <Text style={{ ...type.display, fontSize: 26, color: color.fgPrimary, fontVariant: ['tabular-nums'] }}>{n}</Text>
            <Text style={{ ...type.caption, color: color.fgSecondary }}>{l}</Text>
          </View>
        ))}
      </View>
      {m.screenshots ? <Text style={{ ...type.meta, color: color.personal }}>{mx.screenshots(m.screenshots)}</Text> : null}
      {quietMe ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{mx.quietMe}</Text> : null}
      {!quietMe && m.seen_count === 0 ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{mx.noViews}</Text> : null}
      {m.viewers.map((v) => (
        <View key={v.profile_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, overflow: 'hidden' }}>
            <Photo uri={v.photo} id={v.profile_id} label="" style={{ width: 38, height: 38 }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{`${v.display_name}, ${v.age}`}</Text>
            <Text style={{ ...type.meta, fontSize: 11.5, color: v.screenshot ? color.personal : color.fgSecondary }}>{[v.screenshot ? mx.screenshot : null, mx.ago(M.minutesFrom(v.at))].filter(Boolean).join(' · ')}</Text>
          </View>
          {v.tapped ? <Text style={{ fontSize: 16 }}>🔥</Text> : null}
        </View>
      ))}
      {!quietMe && m.quiet_count > 0 ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{mx.quietly(m.quiet_count)}</Text> : null}
    </ScrollView>
  );
}

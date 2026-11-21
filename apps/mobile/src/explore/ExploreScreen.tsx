import { privateStore as AsyncStorage } from '../app/privateStore';
import { cellToLatLng } from 'h3-js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import type { Card, ExploreSummary, MapData, Mode, Place } from '../api/types';
import { useSession } from '../app/session';
import { distanceLabel, tx } from '../i18n/app';
import { mod } from '../i18n/mod';
import { feel } from '../ui/haptics';
import { GestureDetector, usePinchGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colsAfterPinch, nearIds } from '../ui/gestureMath';
import { settle } from '../ui/motion';
import { setCols, useCols, type Cols } from './gridCols';
import { SafetySheet, SheetRow } from '../trust/SafetySheet';
import { clearMapFocus, useMapFocus } from './focus';
import { useHiddenItems } from '../scene/hiddenItems';
import { toast } from '../ui/Toast';
import { color, radius, space, type } from '../theme/tokens';
import { Banner, EmptyState, ErrorState, Icon, Loading, useAccent } from '../ui';
import { ProfileTile } from './Card';
import { activeFilterCount, defaultFilters, Filters, filterMode, restoreFilters, loadGrid, loadMap, loadPlaces, loadSummary, loadTray, loadVisitors } from './explore';
import { setLookAround, useLookAround } from '../travel/travel';
import { tr } from '../i18n/travel';
import { LiveHeader, VerifyRow } from './LiveHeader';
import { ExploreMap } from './ExploreMap';
import { GridSheet, restoreSnap, Snap, snapHeight } from './GridSheet';
import { activeKinds, defaultLayers, fitCamera, INTENTS, isNear, Layers, PlaceKind, placeKind, restoreIntents, restoreLayers, toggleIntent, toggleLayer } from './mapShared';
import { PlaceCard, PlaceChips } from './Places';
import { NowSheet } from '../me/NowSheet';
import { FiltersSheet } from './FiltersSheet';
import { devicePosition, lastKnown, LatLng, locateDevice, onDevicePosition, syncLocation } from './location';
import { LocationSheet } from './LocationSheet';
import { useFocusEffect } from '@react-navigation/native';
import { MomentsRow } from '../moments/MomentsRow';
import * as Moments from '../moments/api';
import * as People from '../chat/people';
import { convWith, watchMoments } from '../chat/engine';
import { useFriendLocs } from '../chat/friendLoc';
import { ppl } from '../i18n/people';
import { away, filterMap, keep, restoreShow, Show, SHOW_KEY, showIds, wantMore } from './show';
import { readSnapshot, saveSnapshot, snapshotSig } from './snapshot';

const FILTER_KEY = (m: string) => 'thirstr.filters.' + m;
// #113: one filter set for the merged map; chips and place layers saved on the device.
const MERGED_FILTERS = 'thirstr.filters.explore';
const INTENTS_KEY = 'thirstr.exploreIntents';
// #223: v2 so the new defaults (Clubs, Saunas off) reach every phone once.
const LAYERS_KEY = 'thirstr.exploreLayers.v2';
const SNAP_KEY = 'thirstr.exploreSnap';
const HOLD_KEY = 'thirstr.holdHintSeen';
/** Floating tab bar (16 pt inset + 64 pt + 18 pt) the sheet content must clear. */
const TAB_SPACE = 96;

// S-10 / S-11 Explore (F-04). AC-04.1: cold start → profile → Message in ≤ 3 taps.
export function ExploreScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { me, setMe, mode, setMode, refresh } = useSession();
  // RF-5: no main photo yet = invisible; nudge before the verify banner.
  const hasMain = !!me.profile?.photos.some((x) => x.slot === 0 && x.status === 'ok_main');
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState<Snap>('peek');
  const [selected, setSelected] = useState<string | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [screen, setScreen] = useState<{ w: number; h: number } | null>(null);
  const [headerH, setHeaderH] = useState(0);
  const [intents, setIntents] = useState<Mode[]>(() => (INTENTS.includes(mode) ? [...INTENTS] : ['hookup']));
  const [layers, setLayers] = useState<Layers>(defaultLayers);
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [fitM, setFitM] = useState<number | null>(null);
  const [plans, setPlans] = useState(0);
  const [showNow, setShowNow] = useState(false);
  // F-21 R-21.10 (#212): own live Moments for the "＋ You" bubble, refreshed on focus.
  const [myLive, setMyLive] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!me.verified) return;
      Moments.mine()
        .then((l) => setMyLive(Moments.alive(l).length))
        .catch(() => undefined);
    }, [me.verified]),
  );
  const list = useRef<FlatList<Card>>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  // #247 R-04.22: favorites / friends only, filtered on the phone.
  const [show, setShowState] = useState<Show>('all');
  const peopleTick = People.usePeople();
  const [items, setItems] = useState<Card[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [furtherFrom, setFurtherFrom] = useState<number | null>(null);
  const [tray, setTray] = useState<Card[]>([]);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [summary, setSummary] = useState<ExploreSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [quick, setQuick] = useState<Card | null>(null);
  const [holdSeen, setHoldSeen] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(HOLD_KEY).then(
      (v) => setHoldSeen(v === '1'),
      () => {},
    );
  }, []);
  const hold = useCallback((c: Card) => {
    feel('tap');
    setQuick(c);
    setHoldSeen(true);
    AsyncStorage.setItem(HOLD_KEY, '1');
  }, []);
  const bbox = useRef<[number, number, number, number] | null>(null);
  const [locTick, setLocTick] = useState(0);
  const [device, setDevice] = useState<LatLng | null>(devicePosition());
  const [recenter, setRecenter] = useState(0);
  // F-20 R-20.14: Look around a trip city (view point = its centre on the server).
  const look = useLookAround();
  const x = useMemo(() => ({ trip: look?.id ?? null }), [look?.id]);
  const [visiting, setVisiting] = useState<{ count: number; center: { lat: number; lng: number } | null; items: Card[] } | null>(null);
  const [homePlace, setHomePlace] = useState<string | null>(null);
  // Recentre when a trip city is picked (state-from-props, no effect).
  const [seenLook, setSeenLook] = useState(look);
  if (seenLook !== look) {
    setSeenLook(look);
    if (look) setRecenter((n) => n + 1);
  }
  // #210: "Map" on a Tonight party card centres here and shows the map (state-from-props, no effect).
  const focus = useMapFocus();
  const hiddenItems = useHiddenItems();
  const [seenFocus, setSeenFocus] = useState(focus?.seq ?? 0);
  if (focus && focus.seq !== seenFocus) {
    setSeenFocus(focus.seq);
    setRecenter((n) => n + 1);
    setSnap('peek');
  }

  useEffect(() => onDevicePosition(setDevice), []);

  useEffect(() => {
    AsyncStorage.getItem(SNAP_KEY).then((v) => setSnap(restoreSnap(v)));
  }, []);

  // R-04.18: chips + place layers saved on the device; one filter set (falls back to the old Hookup set).
  useEffect(() => {
    AsyncStorage.getItem(INTENTS_KEY).then((v) => setIntents(restoreIntents(v)));
    AsyncStorage.getItem(LAYERS_KEY).then((v) => setLayers(restoreLayers(v)));
    AsyncStorage.getItem(SHOW_KEY).then((v) => setShowState(restoreShow(v)));
    AsyncStorage.getItem(MERGED_FILTERS)
      .then((f) => f ?? AsyncStorage.getItem(FILTER_KEY('hookup')))
      .then((f) => setFilters(restoreFilters(f)));
  }, []);
  // App mode (accent, tab bar, other tabs) follows the first chip.
  useEffect(() => {
    if (intents[0] && intents[0] !== mode) setMode(intents[0]);
  }, [intents, mode, setMode]);
  const onIntent = useCallback((m: Mode) => {
    setIntents((cur) => {
      const next = toggleIntent(cur, m);
      AsyncStorage.setItem(INTENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;
  const focusOn = !!focus;
  const kinds = useMemo(() => {
    if (safe) return [];
    const k = activeKinds(layers, intents);
    return focusOn && !k.includes('parties') ? [...k, 'parties' as const] : k;
  }, [safe, layers, intents, focusOn]);
  const onLayer = useCallback(
    (k: PlaceKind) =>
      setLayers((cur) => {
        const next = toggleLayer(cur, k, intents);
        AsyncStorage.setItem(LAYERS_KEY, JSON.stringify(next));
        return next;
      }),
    [intents],
  );

  // Location refresh on open (R-05.8).
  useEffect(() => {
    const sync = () =>
      syncLocation(me)
        .then((m) => {
          if (!m) return;
          setMe(m);
          setLocTick((t) => t + 1);
        })
        .catch(() => {});
    // R-04.13: ask once + get the device fix first, so the map can centre on it.
    locateDevice()
      .catch(() => null)
      .then(sync);
    // EN-18: refresh only while the app is on screen (no background location/network).
    const id = setInterval(() => AppState.currentState === 'active' && sync(), 5 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.location?.level]);

  // R-04.17: header counts; failure keeps the "·" placeholder, never a made-up number.
  const reloadSummary = useCallback(() => {
    loadSummary(intents, filters, x)
      .then((sm) => {
        if (!x.trip) setHomePlace(sm.place);
        setSummary(sm);
      })
      .catch(() => setSummary(null));
  }, [intents, filters, x]);

  // SR-16: last first page for these settings, shown until the fresh answer lands (or offline).
  const sig = useMemo(() => snapshotSig({ intents, filters, x }), [intents, filters, x]);
  useEffect(() => {
    let live = true;
    readSnapshot(sig).then((s) => {
      if (!live || !s) return;
      setItems((cur) => cur ?? s.items);
      setTray((cur) => (cur.length ? cur : s.tray));
    });
    return () => {
      live = false;
    };
  }, [sig]);

  const reload = useCallback(
    () =>
      Promise.all([
        loadGrid(intents, filters, null, x),
        loadTray(intents, filters, x),
        bbox.current ? loadMap(intents, filters, bbox.current, x) : Promise.resolve(null),
        loadVisitors(intents, filters, x).catch(() => null),
      ]).then(
        ([g, t, m, vis]) => {
          setVisiting(vis);
          setErr(null);
          Moments.clearBadges(g.items.map((c) => c.id));
          setItems(g.items);
          setNext(g.next);
          setFurtherFrom(g.further_from);
          setFitM(g.fit_m ?? null);
          setTray(t.items);
          if (m) setMapData(m);
          void saveSnapshot(sig, g.items, t.items);
        },
        (e) => setErr(e instanceof ApiError ? e.message : tx.common.error),
      ),
    [intents, filters, x, sig],
  );

  useEffect(() => {
    reload();
  }, [reload, me.location?.level, locTick]);

  useEffect(() => {
    reloadSummary();
  }, [reloadSummary, me.location?.level, locTick, me.now]);

  // R-04.20: places for the viewport, from our own API only.
  const reloadPlaces = useCallback(() => {
    const b = bbox.current;
    if (!b) return;
    loadPlaces(kinds, b)
      .then((r) => setPlaces(r.places ?? []))
      .catch(() => {});
  }, [kinds]);
  useEffect(() => {
    reloadPlaces();
  }, [reloadPlaces]);
  const onRegion = useCallback(
    (b: [number, number, number, number]) => {
      bbox.current = b;
      loadMap(intents, filters, b, x)
        .then(setMapData)
        .catch(() => {});
      reloadPlaces();
    },
    [intents, filters, reloadPlaces, x],
  );
  const shownPlaces = places.filter((p) => kinds.includes(placeKind(p)) && !hiddenItems.has(p.id));
  // #210: select the focused party once its marker has loaded.
  const [pickedFor, setPickedFor] = useState(0);
  if (focus && pickedFor !== focus.seq) {
    const fp = shownPlaces.find((p) => p.id === focus.placeId);
    if (fp) {
      setPickedFor(focus.seq);
      setPlace(fp);
    }
  }

  async function more() {
    if (!next) return;
    const g = await loadGrid(intents, filters, next, x);
    setItems((cur) => [...(cur ?? []), ...g.items]);
    setNext(g.next);
  }

  // R-04.18: open in the card's lens = his first intent among the chips.
  const open = useCallback(
    (c: Card) =>
      navigation.navigate('Profile', {
        id: c.id,
        mode: intents.find((m) => (c.intents ?? ['hookup']).includes(m)) ?? intents[0],
        // F-20: profile seen from the trip city (its trip card shows there)
        trip: look?.id,
        // F-19 G10: grid order, so the profile can swipe to the next / previous person.
        ids: nearIds(items, c.id),
      }),
    [navigation, intents, items, look?.id],
  );
  // F-19 G8: pinch the grid for 2, 3 or 4 per row (also in Filters › Grid size).
  const cols = useCols();
  const pinch = useSharedValue(1);
  const pinched = useCallback((n: Cols) => {
    feel('tick');
    setCols(n);
  }, []);
  const gridGesture = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      pinch.set(Math.min(1.12, Math.max(0.9, e.scale)));
    },
    onDeactivate: (e) => {
      'worklet';
      const n = colsAfterPinch(cols, e.scale);
      pinch.set(settle(1, false));
      if (n !== cols) scheduleOnRN(pinched, n);
    },
  });
  const pinchStyle = useAnimatedStyle(() => ({ transform: [{ scale: pinch.get() }] }));

  // R-04.14: one tap on a pin opens the profile; holding it opens Hide / Block / Report (S-21).
  const selectPin = useCallback(
    (c: Card) => {
      setPlace(null);
      setSelected(c.id);
      open(c);
    },
    [open],
  );
  const changeSnap = useCallback((v: Snap) => {
    setSnap(v);
    AsyncStorage.setItem(SNAP_KEY, v);
  }, []);
  useEffect(() => {
    const i = selected && items ? items.findIndex((c) => c.id === selected) : -1;
    if (i >= 0)
      list.current?.scrollToIndex({
        index: Math.floor(i / 3),
        animated: true,
        viewPosition: 0.2,
      });
  }, [selected, items]);
  // R-04.1: the viewer isn't shown in this mode → one tap turns it on (Sport opens its fields).
  const own = me.profile ?? me.profiles?.[0];
  // R-04.18: not shown under any selected chip → one tap adds the first one.
  const notShown = !!own && !intents.some((m) => (own.show_in ?? ['hookup']).includes(m));
  const showMe = useCallback(async () => {
    if (!own) return;
    const order = ['hookup', 'friends', 'sport'] as const;
    const next = order.filter((m) => m === mode || (own.show_in ?? []).includes(m));
    try {
      await api('PATCH', `/me/profiles/${own.id}`, { show_in: next });
      await refresh();
      const sports = own.fields.sports;
      if (mode === 'sport' && !(Array.isArray(sports) && sports.length)) navigation.navigate('EditSection', { id: own.id, section: 'sport' });
    } catch {
      // Stays visible; the banner remains so they can retry.
    }
  }, [own, mode, refresh, navigation]);

  // R-04.13: own device position first (any level, incl. Hidden/City), then pin, last area cell, own coarse cell.
  const dot: LatLng | null = (() => {
    if (device) return device;
    const pin = me.location?.pin;
    if (pin) return { lat: pin.lat, lng: pin.lng };
    const lk = lastKnown();
    if (lk) {
      const [lat, lng] = cellToLatLng(lk.cell);
      return { lat, lng };
    }
    return null;
  })();
  const center: { lat: number; lng: number; zoom?: number } | null = (() => {
    if (focus) return { lat: focus.lat, lng: focus.lng, zoom: 14 };
    if (look) return { lat: look.city.lat, lng: look.city.lng, zoom: 12 };
    if (dot) return dot;
    const r5 = me.location?.cell_r5;
    if (r5) {
      const [lat, lng] = cellToLatLng(r5);
      return { lat, lng };
    }
    return null;
  })();

  // F-20 R-20.11: map bubble (faces for verified viewers only); tap → first visitor tile.
  const visitingPin = useMemo(
    () =>
      visiting && visiting.count > 0 && visiting.center
        ? { ...visiting.center, count: visiting.count, faces: me.verified ? visiting.items.slice(0, 3).map((c) => c.photo) : [] }
        : null,
    [visiting, me.verified],
  );
  const onVisiting = useCallback(() => {
    changeSnap('full');
    const i = items ? items.findIndex((c) => c.visitor) : -1;
    if (i >= 0) list.current?.scrollToIndex({ index: Math.floor(i / 3), animated: true, viewPosition: 0.2 });
  }, [items, changeSnap]);

  // R-04.15: zoom to fit the nearest people above the sheet.
  const sheetPx = box ? snapHeight(snap, box.h, TAB_SPACE) : 0;
  const camera = center && box && screen ? fitCamera(center, fitM, screen.w, screen.h, Math.min(sheetPx, box.h * 0.6), headerH) : center;
  const quiet = !!items && items.length > 0 && !items.some((c) => isNear(c.distance));
  useEffect(() => {
    if (!quiet) return;
    api<{ plans: unknown[] }>('GET', `/tonight?mode=${intents[0]}`)
      .then((r) => setPlans(r.plans?.length ?? 0))
      .catch(() => setPlans(0));
  }, [quiet, intents]);

  async function locateMe() {
    // R-20.14: Locate me returns home and ends Look around (and a #210 party focus).
    if (look) setLookAround(null);
    clearMapFocus();
    const p = await locateDevice().catch(() => null);
    if (!p && !center) return setShowLocation(true);
    setRecenter((n) => n + 1);
  }

  const iconBtn = {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.bgRaised,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  // #247 R-04.22: keep only favorites / friends. The list never leaves the phone.
  const setShow = (v: Show) => {
    setShowState(v);
    AsyncStorage.setItem(SHOW_KEY, v);
    feel('tick');
  };
  const favIds = useMemo(() => People.favList().map((f) => f.peer), [peopleTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const friendIds = useMemo(() => People.friendList('yes'), [peopleTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = useMemo(() => showIds(show, favIds, friendIds), [show, favIds, friendIds]);
  // #221 R-21.9: rings pushed over the socket win over the list's copy until the next load.
  const ringsV = Moments.useRings();
  const ringed = useMemo(() => (items ? Moments.withRings(items, ringsV) : items), [items, ringsV]);
  const shown = useMemo(() => (ringed ? keep(ringed, ids) : ringed), [ringed, ids]);
  const watchKey = (items ?? []).slice(0, 60).map((c) => c.id).join(',');
  useEffect(() => {
    if (watchKey) watchMoments(watchKey.split(','), intents);
  }, [watchKey, intents]);
  // #247 R-07.47: friends who share their spot with me (E2EE), drawn like Area people.
  const friendLocs = useFriendLocs();
  const shownMap = useMemo(() => {
    const m = filterMap(mapData, ids);
    if (!friendLocs.length || look) return m;
    const have = new Set([...(m?.avatars ?? []), ...(m?.pins ?? [])].map((c) => c.id));
    const extra: Card[] = friendLocs
      .filter((f) => !have.has(f.peer) && (!ids || ids.has(f.peer)))
      .map((f) => {
        const c = convWith(f.peer);
        return { id: f.peer, display_name: c?.name ?? '…', age: c?.age ?? 0, verified: !!c?.verified, photo: c?.photo ?? null, online: true, distance: null, now: null, exact: false, pin_expires_at: null, further: false, creator: false, intent: null, position: null, new: false, lat: f.lat, lng: f.lng, intents: ['friends'] };
      });
    return { cells: m?.cells ?? [], pins: m?.pins ?? [], avatars: [...(m?.avatars ?? []), ...extra] };
  }, [mapData, ids, friendLocs, look]);
  const awayIds = useMemo(
    () => away(ids, show === 'fav' ? favIds : friendIds, [...(items ?? []).map((c) => c.id), ...(mapData?.avatars ?? []).map((c) => c.id), ...(mapData?.pins ?? []).map((c) => c.id), ...friendLocs.map((f) => f.peer)]),
    [ids, show, favIds, friendIds, items, mapData, friendLocs],
  );
  const paging = useRef(false);
  useEffect(() => {
    if (paging.current || !wantMore(show, shown?.length ?? 0, next)) return;
    paging.current = true;
    more().finally(() => (paging.current = false));
  }, [show, shown?.length, next]); // eslint-disable-line react-hooks/exhaustive-deps
  const awayPerson = (id: string) => {
    const c = convWith(id);
    const f = People.favList().find((x) => x.peer === id);
    return { id, name: c?.name || f?.name || '?', photo: c?.photo ?? f?.photo ?? null, cid: c?.id ?? null };
  };
  const awayList =
    show !== 'all' && awayIds.length > 0 ? (
      <View testID="show-away" style={{ marginTop: space.l, gap: space.s }}>
        <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 0.8, color: color.fgMuted }}>{ppl.awayTitle(awayIds.length).toUpperCase()}</Text>
        {awayIds.map(awayPerson).map((a) => (
          <Pressable
            key={a.id}
            testID={`away-${a.id}`}
            accessibilityRole="button"
            onPress={() => (a.cid ? navigation.navigate('Chat', { cid: a.cid }) : navigation.navigate('Profile', { id: a.id, mode: intents[0] }))}
            style={({ pressed }) => [{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.m }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.bgOverlay, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {a.photo ? <Image source={{ uri: a.photo }} style={{ width: 44, height: 44 }} /> : <Text style={{ ...type.headline, color: color.fgPrimary }}>{a.name.slice(0, 1).toUpperCase()}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{a.name}</Text>
              <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, color: color.fgMuted }}>{ppl.awayRow}</Text>
            </View>
            <View style={{ height: 36, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: color.bgRaised, justifyContent: 'center' }}>
              <Text style={{ ...type.headline, fontSize: 13, color: color.fgPrimary }}>{ppl.chat}</Text>
            </View>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: space.xs }}>
          <Icon.Lock size={11} c={color.trust} />
          <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted, flex: 1 }}>{ppl.awayHint}</Text>
        </View>
      </View>
    ) : null;

  // App v2 header (design-system.md › App v2 rules): wordmark + location chip + filters; mode switch (no Map/Grid toggle, #100).
  // R-04.17 live header (#104): place + counts + mode tiles. Verify nudge moved into the sheet.
  const banner = !hasMain ? (
    <Banner testID="photo-banner" tone="warn" text={tx.explore.photoBanner} onPress={() => navigation.navigate('EditProfile')} />
  ) : notShown ? (
    <Banner testID="lens-banner" tone="warn" text={tx.explore.notShownIn(tx.modes[intents[0]])} onPress={showMe} />
  ) : safe ? (
    <Banner tone="personal" text={tx.explore.safeMode} />
  ) : null;
  const header = (
    <LiveHeader
      me={me}
      intents={intents}
      onIntent={onIntent}
      summary={summary}
      filtersOn={activeFilterCount(filters)}
      topInset={insets.top}
      onFilters={() => setShowFilters(true)}
      onLocation={() => setShowLocation(true)}
      onNow={() => (me.verified ? setShowNow(true) : navigation.navigate('Verify'))}
      banner={banner}
      trip={look}
      home={homePlace}
      show={show}
      onShow={setShow}
      showCounts={{ fav: favIds.length, friends: friendIds.length }}
      onBack={() => {
        setLookAround(null);
        setRecenter((n) => n + 1);
      }}
    />
  );

  const card = (icon: React.ReactNode, title: string, sub: string, action: string | null, onPress: () => void, testID: string, tint: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.m,
          padding: 14,
          borderRadius: radius.tray,
          backgroundColor: color.bgRaised,
          marginBottom: space.l,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: tint + '29',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.headline, color: color.fgPrimary }}>{title}</Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text>
      </View>
      {action ? (
        <View
          style={{
            height: 40,
            paddingHorizontal: space.l,
            borderRadius: radius.pill,
            backgroundColor: accent,
            justifyContent: 'center',
          }}
        >
          <Text style={{ ...type.headline, fontSize: 14, color: color.onAccent }}>{action}</Text>
        </View>
      ) : (
        <Icon.Next />
      )}
    </Pressable>
  );
  const postNow = () => (me.verified ? setShowNow(true) : navigation.navigate('Verify'));
  const beFirst = card(<Icon.Bolt c={accent} />, tx.explore.beFirst, tx.explore.beFirstBody, tx.explore.post, postNow, 'post-now', accent);

  // R-04.16: quiet area / unverified / nobody. Never invented counts.
  const listHead =
    show !== 'all' ? (
      shown && shown.length === 0 && !next ? <EmptyState title={ppl.showNone[show]} body={ppl.showLocal} /> : null
    ) : items && items.length === 0 ? (
      <View>
        {!me.verified ? card(<Icon.Shield c={color.trust} />, tx.explore.verifyToSee, tx.explore.verifyToSeeBody, null, () => navigation.navigate('Verify'), 'verify-to-see', color.trust) : beFirst}
        <EmptyState title={tx.explore.empty} body={tx.explore.emptyBody} action={tx.explore.filters} onAction={() => setShowFilters(true)} />
      </View>
    ) : quiet ? (
      <View>
        {!me.verified ? <VerifyRow onPress={() => navigation.navigate('Verify')} /> : null}
        <Text
          style={{
            ...type.meta,
            color: color.fgSecondary,
            marginBottom: space.l,
          }}
        >
          {tx.explore.quietBody}
        </Text>
        {beFirst}
        {plans > 0 ? card(<Icon.Moon c={accent} />, tx.explore.tonightRow(plans), tx.tabs.tonight, null, () => navigation.navigate('Tonight'), 'tonight-row', accent) : null}
        <Text
          style={{
            ...type.caption,
            fontSize: 12,
            letterSpacing: 0.8,
            color: color.fgMuted,
            marginBottom: space.s,
          }}
        >
          {tx.explore.further.toUpperCase()}
        </Text>
      </View>
    ) : items && !me.verified ? (
      <VerifyRow onPress={() => navigation.navigate('Verify')} />
    ) : null;
  // R-20.17: Look around into a Safe Mode country: locals there are protected.
  const head = look?.safe_mode_country ? (
    <View>
      <Banner tone="trust" text={tr.protected} />
      {listHead}
    </View>
  ) : (
    listHead
  );

  const sheetTitle = show !== 'all' ? `${ppl.show[show]} · ${shown?.length ?? 0}` : tray.length > 0 ? tx.explore.activeNow(tray.length) : quiet ? tx.explore.quietTitle : tx.explore.nearby;
  const listPad = box ? TAB_SPACE + space.xxl + (box.h - sheetPx) : 120;

  let body: React.ReactNode;
  if (err && !items) body = <ErrorState text={err} retry={tx.common.retry} onRetry={reload} />;
  else if (!items || !box) body = <Loading />;
  else
    body = (
      <View style={{ flex: 1 }}>
        {/* #113 option B: the map runs full-bleed behind the floating header */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            top: -headerH,
          }}
        >
          <ExploreMap
            center={camera}
            me={dot}
            data={shownMap}
            accent={accent}
            recenter={recenter}
            onRegion={onRegion}
            onSelect={selectPin}
            onHold={hold}
            onClear={() => {
              setSelected(null);
              setPlace(null);
            }}
            selected={selected}
            places={shownPlaces}
            selectedPlace={place?.id ?? null}
            visiting={visitingPin}
            onVisiting={onVisiting}
            onPlace={(p) => {
              setSelected(null);
              setPlace((cur) => (cur?.id === p.id ? null : p));
            }}
          />
        </View>
        <GridSheet
          h={box.h}
          bottom={TAB_SPACE}
          snap={snap}
          onSnap={changeSnap}
          title={sheetTitle}
          right={items.length ? (look ? tr.fromCentre : tx.explore.nearestFirst) : undefined}
          above={
            place ? (
              <View style={{ flex: 1 }}>
                <PlaceCard
                  p={place}
                  onClose={() => setPlace(null)}
                  onCheckIn={() =>
                    navigation.navigate('Venue', {
                      venue: {
                        id: place.id,
                        name: place.name,
                        kind: place.kind,
                        geofence_radius_m: 80,
                        here: place.here ?? '0',
                        area_cell: '',
                        distance: place.distance,
                      },
                    })
                  }
                  onJoin={() => navigation.navigate('Party', { id: place.id })}
                />
              </View>
            ) : (
              <>
                <View style={{ flex: 1 }}>{snap === 'full' ? null : !safe ? <PlaceChips active={kinds} onToggle={onLayer} /> : null}</View>
                {snap !== 'full' ? (
                  <Pressable
                    testID="locate-me"
                    accessibilityRole="button"
                    accessibilityLabel={tx.explore.locateMe}
                    onPress={locateMe}
                    style={({ pressed }) => [iconBtn, { backgroundColor: color.bgInverse }, pressed && { opacity: 0.8 }]}
                  >
                    <Icon.Locate c={color.onAccent} />
                  </Pressable>
                ) : null}
              </>
            )
          }
        >
          <GestureDetector gesture={gridGesture}>
          <Animated.View style={[{ flex: 1 }, pinchStyle]}>
          <FlatList showsVerticalScrollIndicator={false}
            key={`cols-${cols}`}
            ref={list}
            data={shown ?? []}
            numColumns={cols}
            keyExtractor={(c) => c.id}
            columnWrapperStyle={{ gap: space.s }}
            contentContainerStyle={{ gap: space.s, paddingHorizontal: space.l, paddingBottom: listPad }}
            ListHeaderComponent={
              head || (!holdSeen && items.length > 0) || items.length > 0 ? (
                <View>
                  {/* F-21 D-21a B; #250: Moments row on top of the grid in both stops (the strip shows it). */}
                  {!look ? (
                    <MomentsRow
                      items={ringed ?? []}
                      myId={own?.id ?? 'me'}
                      myPhoto={own?.photos.find((x) => x.slot === 0)?.thumb_url ?? own?.photos.find((x) => x.slot === 0)?.url ?? null}
                      myLive={myLive}
                      onAdd={() => navigation.navigate(me.verified ? 'MomentNew' : 'Verify')}
                      onMine={() => navigation.navigate('Moments', { queue: [{ id: own?.id ?? 'me', name: own?.display_name ?? '', age: own?.age ?? 0, photo: null }], index: 0, mode: intents[0], self: true })}
                      onOpen={(people, i) =>
                        navigation.navigate('Moments', {
                          queue: people.map((c) => ({ id: c.id, name: c.display_name, age: c.age, photo: c.photo, where: distanceLabel(c.distance) })),
                          index: i,
                          mode: intents.find((m) => (people[i].intents ?? ['hookup']).includes(m)) ?? intents[0],
                        })
                      }
                    />
                  ) : null}
                  {head}
                  {!holdSeen && items.length > 0 ? (
                    <Text testID="hold-hint" style={{ ...type.meta, fontFamily: type.headline.fontFamily, color: color.trust, marginBottom: space.s }}>
                      {mod.holdHint}
                    </Text>
                  ) : null}
                </View>
              ) : undefined
            }
            ListFooterComponent={awayList ?? undefined}
            onEndReached={more}
            onEndReachedThreshold={0.5}
            onScrollToIndexFailed={(e) =>
              list.current?.scrollToOffset({
                offset: e.averageItemLength * e.index,
                animated: true,
              })
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={accent}
                onRefresh={async () => {
                  setRefreshing(true);
                  reloadSummary();
                  await reload();
                  setRefreshing(false);
                }}
              />
            }
            renderItem={({ item, index }) => (
              <View style={{ flex: 1 / cols }}>
                {index === furtherFrom && !quiet ? <Text style={{ ...type.caption, color: color.fgSecondary, marginBottom: 4 }}>{tx.explore.further}</Text> : null}
                <ProfileTile card={item} selected={item.id === selected} onPress={() => open(item)} onLongPress={() => hold(item)} />
              </View>
            )}
          />
          </Animated.View>
          </GestureDetector>
        </GridSheet>
      </View>
    );

  return (
    <View
      style={{ flex: 1, backgroundColor: color.bgMap }}
      onLayout={(e) =>
        setScreen({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      <View
        style={{ flex: 1, marginTop: headerH }}
        onLayout={(e) =>
          setBox({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        {body}
      </View>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0 }} onLayout={(e) => setHeaderH(Math.round(e.nativeEvent.layout.height))}>
        {header}
      </View>
      <FiltersSheet
        visible={showFilters}
        mode={filterMode(intents)}
        verified={me.verified}
        value={filters}
        onClose={() => setShowFilters(false)}
        onApply={(f) => {
          setFilters(f);
          AsyncStorage.setItem(MERGED_FILTERS, JSON.stringify(f));
          setShowFilters(false);
        }}
      />
      <NowSheet visible={showNow} onClose={() => setShowNow(false)} />
      <LocationSheet visible={showLocation} onClose={() => setShowLocation(false)} />
      <SafetySheet
        visible={!!quick}
        target={quick ? { id: quick.id, name: quick.display_name, age: quick.age, sub: distanceLabel(quick.distance) } : null}
        onClose={() => setQuick(null)}
        onReport={(t) => navigation.navigate('Report', { profileId: t.id, context: 'explore' })}
        onGone={(_, t) => {
          setItems((cur) => cur?.filter((c) => c.id !== t.id) ?? cur);
          setMapData((m) => (m ? { ...m, pins: m.pins.filter((c) => c.id !== t.id), avatars: m.avatars.filter((c) => c.id !== t.id) } : m));
          if (selected === t.id) {
            setSelected(null);
          }
          reloadSummary();
        }}
        onRestored={() => {
          reload();
          reloadSummary();
        }}
        lead={
          quick ? (
            <>
              <SheetRow
                testID="quick-open"
                title={mod.openProfile}
                onPress={() => {
                  const c = quick;
                  setQuick(null);
                  open(c);
                }}
              />
              <SheetRow
                testID="quick-tap"
                title={tx.explore.quick.tap}
                onPress={() => {
                  const c = quick;
                  setQuick(null);
                  api('POST', `/profiles/${c.id}/tap`).then(
                    () => toast(mod.tapped(c.display_name)),
                    (e) => toast(e instanceof ApiError ? e.message : tx.common.error),
                  );
                }}
              />
              <SheetRow
                last
                testID="quick-message"
                title={tx.explore.quick.message}
                onPress={() => {
                  const c = quick;
                  setQuick(null);
                  if (!me.verified) toast(tx.explore.unverifiedMessage, { label: tx.me.verifyNow, on: () => navigation.navigate('Verify') });
                  else open(c);
                }}
              />
            </>
          ) : null
        }
      />
    </View>
  );
}


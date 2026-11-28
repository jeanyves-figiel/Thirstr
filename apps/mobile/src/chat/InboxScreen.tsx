import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { knownTrip, useTripsVersion } from '../travel/peerTrips';
import { a11yLabel, shortLabel, TravelLabel } from '../travel/travel';
import { Pressable, ScrollView, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { Tap } from '../api/types';
import { tx } from '../i18n/app';
import { ppl } from '../i18n/people';
import { color, font, radius, space, type } from '../theme/tokens';
import { EmptyState, Icon, ListRow, Photo, Segmented, Sheet, VerifiedTick } from '../ui';
import { v2 } from '../i18n/v2';
import { answerFriend, Conv, deleteConv, getConvs, pull, refreshPeer, setConv } from './engine';
import { usePull } from '../ui/pull';
import { SwipeRow, type SwipeAction } from '../ui/SwipeRow';
import { toast } from '../ui/Toast';
import { gx } from '../i18n/gestures';

import { useTopics } from './hooks';
import { TapsButton, TypingLine } from './TapsButton';
import * as P from './people';
import { SafetySheet, SheetRow } from '../trust/SafetySheet';
import { RestoreCard } from '../me/settings/ChatBackupScreen';
import { TransferCard } from '../me/TransferPanel';
import { RefillCard } from '../refill/RefillUI';

type Nav = { navigate: (s: string, p?: object) => void };
type Tab = 'all' | 'unread' | 'fav' | 'friends';
type Row = { kind: 'conv'; c: Conv } | { kind: 'fav'; peer: string; name: string; photo: string | null } | { kind: 'request'; c: Conv };

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return new Date(t).toLocaleDateString();
};


// S-40 Inbox (R-07.8, R-07.15, R-07.32–R-07.34): search, All / Unread / Favorites / Friends,
// favorites strip, Taps row, New, Parties & groups, Chats.
// #211 Spotlight (R-07.40–R-07.42): full-width Taps button, E2E chip, rings by state, Your move, typing.
export function InboxScreen({ navigation }: { navigation: Nav }) {
  useTopics('convs');
  P.usePeople();
  useTripsVersion();
  const tapsTick = useTopics('taps');
  const insets = useSafeAreaInsets();
  const [taps, setTaps] = useState<Tap[] | null>(null);
  const [menu, setMenu] = useState<Conv | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const loadTaps = useCallback(
    () =>
      api<{ taps: Tap[] }>('GET', '/taps')
        .then((r) => setTaps(r.taps))
        .catch(() => setTaps([])),
    [],
  );
  useEffect(() => {
    loadTaps();
  }, [tapsTick, loadTaps]);
  // F-19 G6 (#187): pull = fetch waiting messages + Taps now.
  const refresh = usePull(useCallback(() => Promise.all([pull(), loadTaps()]), [loadTaps]));

  const all = getConvs().filter((c) => c.last || c.groups.length);
  const byPeer = useMemo(() => new Map(all.filter((c) => !c.ctx).map((c) => [c.peer, c])), [all]);

  // R-07.33: Friends tab refreshes online state of friends once per visit.
  useEffect(() => {
    if (tab !== 'friends') return;
    for (const peer of P.friendList('yes').slice(0, 50)) {
      const c = byPeer.get(peer);
      if (c) refreshPeer(c).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const hit = (c: Conv) => P.matches(q, c.peer, c.name, c.last);
  const pinned = (a: Conv, b: Conv) => Number(!!b.starred) - Number(!!a.starred);
  const recent = (a: Conv, b: Conv) => b.lastAt - a.lastAt;
  const conv = (c: Conv): Row => ({ kind: 'conv', c });

  let sections: { title: string; data: Row[] }[] = [];
  if (tab === 'all' || tab === 'unread') {
    const live = all.filter((c) => !!c.archived === showArchived && (tab !== 'unread' || !!c.unread) && hit(c));
    const groups = live.filter((c) => !!c.ctx).sort(recent).sort(pinned);
    const fresh = live.filter((c) => !c.ctx && c.theyWrote && !c.iWrote).sort(recent);
    const chats = live.filter((c) => !c.ctx && !(c.theyWrote && !c.iWrote)).sort(recent);
    sections = [
      { title: tx.chat.yourMove, data: fresh.map(conv) },
      { title: tx.chat.parties, data: groups.map(conv) },
      { title: showArchived ? tx.chat.archived : tx.chat.chats, data: chats.map(conv) },
    ];
  } else if (tab === 'fav') {
    const favs = P.favList();
    const withChat = favs.map((f) => byPeer.get(f.peer)).filter((c): c is Conv => !!c && hit(c)).sort(recent);
    const without = favs.filter((f) => !byPeer.has(f.peer) && P.matches(q, f.peer, f.name));
    sections = [
      {
        title: ppl.favSection,
        data: [...withChat.map(conv), ...without.map((f): Row => ({ kind: 'fav', peer: f.peer, name: f.name ?? '…', photo: f.photo ?? null }))],
      },
    ];
  } else {
    const req = P.friendList('in').map((p) => byPeer.get(p)).filter((c): c is Conv => !!c && hit(c));
    const fr = P.friendList('yes').map((p) => byPeer.get(p)).filter((c): c is Conv => !!c && hit(c));
    const byName = (a: Conv, b: Conv) => a.name.localeCompare(b.name);
    sections = [
      { title: ppl.requests, data: req.map((c): Row => ({ kind: 'request', c })) },
      { title: ppl.online, data: fr.filter((c) => c.online).sort(byName).map(conv) },
      { title: ppl.friends, data: fr.filter((c) => !c.online).sort(byName).map(conv) },
    ];
  }
  sections = sections.filter((s) => s.data.length);

  const archivedCount = all.filter((c) => c.archived).length;
  const favStrip = tab === 'all' && !q && !showArchived ? P.favList().slice(0, 12) : [];
  const empty = sections.length === 0;
  const emptyText = q
    ? { title: ppl.noResults, body: '' }
    : tab === 'fav'
      ? { title: ppl.noFav, body: ppl.noFavBody }
      : tab === 'friends'
        ? { title: ppl.noFriends, body: ppl.noFriendsBody }
        : { title: tx.chat.empty, body: tx.chat.emptyBody };
  // E2EE now sits in the header chip; the footer only explains Favorites / Friends.
  const footer = tab === 'friends' ? ppl.friendsFooter : tab === 'fav' ? ppl.favFooter : null;
  const unreadChats = all.filter((c) => !c.archived && c.unread > 0).length;
  /** R-07.42: ring = state. Unread coral, friend violet, else none (favorites strip: sunflower). */
  const ringOf = (c: Conv | undefined, fallback: string) => (c?.unread ? color.hookup : c && !c.ctx && P.friendOf(c.peer) === 'yes' ? color.friends : fallback);

  const openPeer = (peer: string) => {
    const c = byPeer.get(peer);
    if (c) navigation.navigate('Chat', { cid: c.id });
    else navigation.navigate('Profile', { id: peer });
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: insets.top + space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.l, marginBottom: space.m, gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 38, color: color.fgPrimary, flexShrink: 1 }}>
          {tx.chat.title}
        </Text>
        <View testID="inbox-e2ee" accessibilityLabel={v2.inbox.e2ee} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, marginBottom: 4, borderRadius: radius.pill, backgroundColor: color.trustTint }}>
          <Icon.Lock size={13} w={2.6} />
          <Text style={{ ...type.caption, fontSize: 12, color: color.trust }}>{tx.chat.e2eChip}</Text>
        </View>
      </View>
      <View style={{ marginHorizontal: space.l, marginBottom: space.m, height: 44, borderRadius: radius.pill, backgroundColor: color.bgRaised, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.l }}>
        <Icon.Search />
        <TextInput
          testID="inbox-search"
          value={q}
          onChangeText={setQ}
          placeholder={ppl.search}
          placeholderTextColor={color.fgMuted}
          accessibilityLabel={ppl.search}
          autoCorrect={false}
          returnKeyType="search"
          style={{ flex: 1, color: color.fgPrimary, fontFamily: font.regular, fontSize: 15, paddingVertical: 0 }}
        />
        {q ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tx.common.close} onPress={() => setQ('')} hitSlop={10}>
            <Icon.Close size={16} c={color.fgMuted} />
          </Pressable>
        ) : null}
      </View>
      {!q ? <TapsButton taps={taps} onPress={() => navigation.navigate('Taps')} /> : null}
      <View style={{ paddingHorizontal: space.l, marginBottom: space.s, flexDirection: 'row' }}>
        <Segmented
          label={tx.chat.title}
          value={tab}
          onChange={setTab}
          grow
          options={[
            { value: 'all', label: ppl.tabs.all },
            { value: 'unread', label: ppl.tabs.unread, badge: unreadChats },
            { value: 'fav', label: ppl.tabs.fav },
            { value: 'friends', label: ppl.tabs.friends },
          ]}
        />
      </View>
      <SectionList showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag"
        refreshControl={refresh}
        sections={sections}
        keyExtractor={(r) => (r.kind === 'fav' ? 'f:' + r.peer : (r.kind === 'request' ? 'r:' : '') + r.c.id)}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            {!q ? <TransferCard /> : null}
            {!q ? <RestoreCard /> : null}
            {/* F-25 (#339): one private Refill card (intro, someone back, or my sealed yes). */}
            {tab === 'all' && !q && !showArchived ? <RefillCard navigation={navigation} /> : null}
            {favStrip.length ? (
              <ScrollView keyboardDismissMode="on-drag" testID="fav-strip" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingHorizontal: space.l, paddingVertical: space.s }}>
                {favStrip.map((f) => {
                  const c = byPeer.get(f.peer);
                  return (
                    <Pressable key={f.peer} testID={`fav-${f.peer}`} accessibilityRole="button" accessibilityLabel={`${ppl.favorite}: ${c?.name ?? f.name ?? ''}`} onPress={() => openPeer(f.peer)} style={{ width: 64, alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2.5, borderColor: ringOf(c, color.personal), padding: 3 }}>
                        <Photo uri={c?.photo ?? f.photo ?? null} id={f.peer} label="" style={{ width: 51, height: 51, borderRadius: 26 }} />
                        {c?.online ? <View style={{ position: 'absolute', right: 0, bottom: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: color.sport, borderWidth: 3, borderColor: color.bgBase }} /> : null}
                      </View>
                      <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, fontFamily: font.bold, color: color.fgSecondary, maxWidth: 64 }}>
                        {(c?.name ?? f.name ?? '…').split(',')[0]}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {empty ? <EmptyState title={emptyText.title} body={emptyText.body} /> : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 0.8, color: color.fgMuted, textTransform: 'uppercase', paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xs }}>
            {section.title}
          </Text>
        )}
        renderItem={({ item: r }) => {
          if (r.kind === 'fav') {
            return (
              <Pressable testID={`favrow-${r.peer}`} accessibilityRole="button" onPress={() => navigation.navigate('Profile', { id: r.peer })} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s }}>
                <Photo uri={r.photo} id={r.peer} label="" style={{ width: 56, height: 56, borderRadius: radius.pill }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ ...type.headline, color: color.fgPrimary, flexShrink: 1 }}>{r.name}</Text>
                    <Icon.Star size={14} c={color.personal} fill={color.personal} />
                  </View>
                  <NoteLine peer={r.peer} />
                </View>
                <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.hookup }}>{ppl.sayHi}</Text>
              </Pressable>
            );
          }
          if (r.kind === 'request') {
            return (
              <View testID={`req-${r.c.peer}`} style={{ marginHorizontal: space.l, marginVertical: space.xs, padding: space.m, borderRadius: radius.tray, backgroundColor: color.bgRaised, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Chat', { cid: r.c.id })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                  <Photo uri={r.c.photo} id={r.c.peer} label="" style={{ width: 44, height: 44, borderRadius: 22 }} />
                  <Text numberOfLines={2} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary, flex: 1 }}>{ppl.askedYou(r.c.name)}</Text>
                </Pressable>
                <Pressable testID={`req-no-${r.c.peer}`} accessibilityRole="button" accessibilityLabel={ppl.notNow} onPress={() => answerFriend(r.c.id, false)} hitSlop={6} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.line, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon.Close size={16} c={color.fgSecondary} />
                </Pressable>
                <Pressable testID={`req-yes-${r.c.peer}`} accessibilityRole="button" onPress={() => answerFriend(r.c.id, true)} style={{ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: color.friends, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{ppl.accept}</Text>
                </Pressable>
              </View>
            );
          }
          const c = r.c;
          const fav = !c.ctx && P.isFav(c.peer);
          const friend = !c.ctx && P.friendOf(c.peer) === 'yes';
          // F-19 G5: swipe right = Favorite (Pin for groups); swipe left = Archive (long swipe) and Mute.
          const starOn = c.ctx ? !!c.starred : fav;
          const lead: SwipeAction[] = c.gone
            ? []
            : [
                {
                  key: 'fav',
                  label: c.ctx ? (starOn ? ppl.unpin : ppl.pin) : starOn ? ppl.removeFav : ppl.favorite,
                  icon: <Icon.Star size={20} c={color.onAccent} fill={starOn ? 'none' : color.onAccent} />,
                  fill: color.personal,
                  on: () =>
                    c.ctx
                      ? setConv(c.id, { starred: !starOn })
                      : P.setFav(c.peer, !starOn, { name: c.name, photo: c.photo }).then(() => toast(starOn ? gx.favOff : gx.favOn)),
                },
              ];
          const trail: SwipeAction[] = [
            {
              key: 'archive',
              label: c.archived ? tx.chat.unarchive : tx.chat.archive,
              icon: <Icon.Archive c={color.onAccent} />,
              fill: color.friends,
              on: () =>
                setConv(c.id, { archived: !c.archived }).then(() => {
                  if (!c.archived) toast(gx.archived, { label: gx.undo, on: () => setConv(c.id, { archived: false }) });
                }),
            },
            { key: 'mute', label: c.muted ? tx.chat.unmute : tx.chat.mute, icon: <Icon.Mute c={color.onAccent} />, fill: color.fgMuted, on: () => setConv(c.id, { muted: !c.muted }) },
          ];
          return (
            <SwipeRow testID={`swipe-row-${c.peer}`} left={lead} right={trail}>
            <Pressable
              testID={`conv-${c.peer}`}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Chat', { cid: c.id })}
              onLongPress={() => setMenu(c)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s, opacity: c.gone ? 0.5 : 1 }}
            >
              <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2.5, borderColor: ringOf(c, 'transparent'), padding: 1.5, marginLeft: -3, marginVertical: -3 }}>
                <Photo uri={c.photo} id={c.peer} label="" style={{ width: 54, height: 54, borderRadius: radius.pill }} />
                {c.online && !c.ctx ? <View style={{ position: 'absolute', right: -2, bottom: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: color.sport, borderWidth: 3, borderColor: color.bgBase }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text numberOfLines={1} style={{ ...type.headline, color: color.fgPrimary, flexShrink: 1 }}>
                    {c.gone ? tx.chat.gone : c.name}
                  </Text>
                  {c.verified ? <VerifiedTick size={14} /> : null}
                  {fav || (c.ctx && c.starred) ? <Icon.Star size={14} c={color.personal} fill={color.personal} /> : null}
                  {friend ? (
                    <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.friends }}>
                      <Text style={{ ...type.caption, color: color.onAccent }}>{ppl.friend}</Text>
                    </View>
                  ) : null}
                  {c.muted ? <Text style={{ ...type.caption, color: color.fgMuted }}>{v2.inbox.muted}</Text> : null}
                </View>
                <TypingLine cid={c.ctx ? null : c.id} tint={c.unread ? color.hookup : color.friends}>
                  <Text numberOfLines={1} style={{ ...type.body, fontSize: 14, color: c.unread ? color.fgPrimary : color.fgSecondary, fontFamily: c.unread ? type.headline.fontFamily : type.body.fontFamily }}>
                    {c.last}
                  </Text>
                </TypingLine>
                {!c.ctx ? <NoteLine peer={c.peer} /> : null}
                {/* F-20 R-20.8: known on this phone (profile or chat opened) */}
                {!c.ctx && knownTrip(c.peer) ? <TravelLabel small text={shortLabel(knownTrip(c.peer)!)} a11y={a11yLabel(knownTrip(c.peer)!)} /> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={{ ...type.meta, fontSize: 12, color: c.unread && !c.muted ? color.hookup : color.fgMuted, fontFamily: c.unread ? font.bold : font.medium }}>{ago(c.lastAt)}</Text>
                {c.unread ? (
                  <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: c.muted ? color.fgMuted : color.hookup, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ ...type.caption, color: color.onAccent }}>{c.unread}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            </SwipeRow>
          );
        }}
        ListFooterComponent={
          <>
            {(tab === 'all' || tab === 'unread') && (archivedCount || showArchived) ? (
              <Pressable accessibilityRole="button" onPress={() => setShowArchived(!showArchived)} style={{ padding: space.l }}>
                <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>
                  {showArchived ? tx.chat.chats : `${tx.chat.archived} · ${archivedCount}`}
                </Text>
              </Pressable>
            ) : null}
            {footer ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: space.l }}>
              <Icon.Lock />
              <Text style={{ ...type.meta, fontSize: 12, fontFamily: type.headline.fontFamily, color: color.trust, textAlign: 'center', flexShrink: 1 }}>{footer}</Text>
            </View>
            ) : null}
          </>
        }
      />
      {menu && (menu.ctx || menu.gone) ? (
        <Sheet visible onClose={() => setMenu(null)} title={menu.name} closeLabel={tx.common.close}>
          <View>
            {menu.ctx ? (
              <ListRow title={menu.starred ? ppl.unpin : ppl.pin} onPress={() => setConv(menu.id, { starred: !menu.starred }).then(() => setMenu(null))} />
            ) : (
              <ListRow
                testID="menu-fav"
                title={P.isFav(menu.peer) ? ppl.removeFav : ppl.addFav}
                onPress={() => P.setFav(menu.peer, !P.isFav(menu.peer), { name: menu.name, photo: menu.photo }).then(() => setMenu(null))}
              />
            )}
            <ListRow title={menu.muted ? tx.chat.unmute : tx.chat.mute} onPress={() => setConv(menu.id, { muted: !menu.muted }).then(() => setMenu(null))} />
            <ListRow title={menu.archived ? tx.chat.unarchive : tx.chat.archive} onPress={() => setConv(menu.id, { archived: !menu.archived }).then(() => setMenu(null))} />
            <ListRow title={tx.chat.deleteChat} danger onPress={() => deleteConv(menu.id).then(() => setMenu(null))} />
          </View>
        </Sheet>
      ) : (
        // #111 S-51: hold a 1:1 chat = shared Hide / Block / Report sheet + chat actions.
        <SafetySheet
          visible={!!menu}
          target={menu ? { id: menu.peer, name: menu.name, age: menu.age } : null}
          onClose={() => setMenu(null)}
          onReport={(t) => menu && navigation.navigate('Report', { profileId: t.id, cid: menu.id })}
          onGone={(kind) => {
            if (kind === 'block' && menu) setConv(menu.id, { archived: true });
          }}
        >
          {menu ? (
            <>
              <SheetRow testID="menu-fav" title={P.isFav(menu.peer) ? ppl.removeFav : ppl.addFav} onPress={() => P.setFav(menu.peer, !P.isFav(menu.peer), { name: menu.name, photo: menu.photo }).then(() => setMenu(null))} />
              <SheetRow title={menu.muted ? tx.chat.unmute : tx.chat.mute} onPress={() => setConv(menu.id, { muted: !menu.muted }).then(() => setMenu(null))} />
              <SheetRow title={menu.archived ? tx.chat.unarchive : tx.chat.archive} onPress={() => setConv(menu.id, { archived: !menu.archived }).then(() => setMenu(null))} />
              <SheetRow last danger title={tx.chat.deleteChat} onPress={() => deleteConv(menu.id).then(() => setMenu(null))} />
            </>
          ) : null}
        </SafetySheet>
      )}
    </View>
  );
}

/** R-07.35: sunflower pen + note (tags first, else text) under the preview. */
function NoteLine({ peer }: { peer: string }) {
  const line = P.noteLine(peer);
  if (!line) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Icon.Pen size={12} w={2.6} />
      <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, fontFamily: font.bold, color: color.personal, flexShrink: 1 }}>
        {line}
      </Text>
    </View>
  );
}

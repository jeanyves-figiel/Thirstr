import { a11yLabel, daysUntil, rangeLabel, shortLabel, TravelLabel } from '../travel/travel';
import { usePeerTrip } from '../travel/peerTrips';
import { tr } from '../i18n/travel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { SafetySheet, SheetRow } from '../trust/SafetySheet';
import { color, font, radius, space, type } from '../theme/tokens';
import { Banner, Icon, ListRow, Loading, Photo, Segmented, setBottomPanel, Sheet, Toggle, useAccent, useNavSpace, VerifiedTick } from '../ui';
import * as E from './engine';
import { useTopics } from './hooks';
import { MediaBubble, sendPhotos } from './media';
import { MediaTray } from './MediaTray';
import { AlbumCard } from './AlbumCard';
import { mx } from '../i18n/media';
import { trx } from '../i18n/translate';
import { prefs } from '../me/prefs';
import { TranslatedText } from './TranslatedText';
import { ChatShield, MeetupCard, useCheckin } from '../safety/live';
import { chatLines, cueDismissed, meetupCue } from '../safety/quick';
import { langName, modeFor, targetLang, translateAvailable } from './translate';
import { ppl } from '../i18n/people';
import * as P from './people';
import { NoteSheet, NoteStrip } from '../profile/PrivateNote';
import { findHits, Marked } from './find';
import * as V from './vcheck';
import { vcAvailable, VcAskSheet, VcBadge, VcRecorder, VcRow, VcViewer } from './VideoCheck';
import { vcx } from '../i18n/vcheck';
import * as Clipboard from 'expo-clipboard';
import { gx } from '../i18n/gestures';
import { feel } from '../ui/haptics';
import { toast } from '../ui/Toast';
import { hitSlot, MsgRow, ReactionBar, useChatGestures, type Hold } from './MsgGestures';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void; setOptions: (o: object) => void };
/** #210 draft: text placed in the composer, not sent ("I'm in" on a Tonight plan). */
type Params = { cid?: string; profileId?: string; name?: string; draft?: string };

const REACTIONS = ['❤️', '🔥', '😂', '😮', '👍'];
// F-19 G3: reaction bar geometry (5 emoji).
const BAR_W = 5 * 52;
const BAR_H = 52;
// Last keyboard height seen (R-08.11: the tray takes its place).
let lastKb = 0;
const HIDDEN = new Set<E.Payload['t']>(['reaction', 'read', 'delivered', 'resync', 'profile.private']);

function statusText(m: E.Msg, group: boolean): string {
  switch (m.status) {
    case 'failed':
      return tx.chat.failed;
    case 'sending':
      return tx.chat.sending;
    case 'read':
      return group && m.readBy?.length ? tx.chat.readBy(m.readBy.length) : tx.chat.read;
    case 'delivered':
      return tx.chat.delivered;
    default:
      return tx.chat.sent;
  }
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'not_verified') return tx.chat.unverified;
    if (e.code === 'unavailable') return tx.chat.unavailable;
    if (e.code === 'rate_limited') return tx.chat.rateLimited;
  }
  return tx.common.error;
}

// S-41 Chat (F-07): header, E2EE line, messages, quick replies, composer.
// F-14 entrapment warning: unverified, or a meet request in his first 5 messages (local check).
const MEET = /\b(meet|come over|my place|your place|address|where are you|now\?|tonight|treffen|vorbei|rencontr|chez (moi|toi))\b/i;
function careful(c: E.Conv, list: E.Msg[]) {
  if (!c.verified) return true;
  return list
    .filter((m) => m.from === 'them')
    .slice(0, 5)
    .some((m) => MEET.test((m.p as { text?: string }).text ?? ''));
}

export function ChatScreen({ navigation, route }: { navigation: Nav; route: { params: Params } }) {
  const { me } = useSession();
  const accent = useAccent();
  const insets = useSafeAreaInsets();
  // #134/#137: bottom bars sit on the nav bar, or right on the keyboard while typing.
  const { kb, bottom: navBottom } = useNavSpace();
  const [cid, setCid] = useState<string | null>(route.params.cid ?? null);
  const [list, setList] = useState<E.Msg[] | null>(null);
  const [text, setText] = useState(route.params.draft ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  // F-19 G1 reply being written, G3 held message (reaction bar + actions).
  const [reply, setReply] = useState<{ re: E.Re; mine: boolean } | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [held, setHeld] = useState<(Hold & { m: E.Msg }) | null>(null);
  const heldRef = useRef(held);
  useEffect(() => {
    heldRef.current = held;
  }, [held]);
  useEffect(() => {
    if (reply) input.current?.focus();
  }, [reply]);
  const g = useChatGestures();
  const anchor = useRef<React.ComponentRef<typeof View>>(null);
  const [rootY, setRootY] = useState(0);
  const [custom, setCustom] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  // R-07.39 search in this chat (null = off).
  const [find, setFind] = useState<string | null>(null);
  const [hitAt, setHitAt] = useState(0);
  const listRef = useRef<FlatList<{ m: E.Msg; r: string[]; mineR: string }>>(null);
  P.usePeople();
  V.useVc();
  // F-18 R-18.8–R-18.14 (#159) video check: request sheet, recorder, viewer.
  const [vcAsk, setVcAsk] = useState(false);
  const [vcRec, setVcRec] = useState<{ rid: string; move: number; offer?: boolean } | null>(null);
  const [vcWatch, setVcWatch] = useState<V.Vc | null>(null);
  // R-08.11 media tray in the keyboard slot (replaces the "Send a photo" sheet, #135).
  const [tray, setTray] = useState(false);
  const [kbH, setKbH] = useState(lastKb);
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      lastKb = e.endCoordinates.height;
      setKbH(lastKb);
      setTray(false);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    setBottomPanel(tray);
    return () => setBottomPanel(false);
  }, [tray]);
  // R-07.28: language of the first translated message, for the teal note at the top of the chat.
  const [trFrom, setTrFrom] = useState<string | null>(null);
  const onTranslated = useCallback((from: string) => setTrFrom((cur) => cur ?? from), []);

  // Open by profile id (Profile › Message): from my one profile (R-06.1).
  useEffect(() => {
    if (cid || !route.params.profileId) return;
    const mine = me.profile;
    if (!mine) return;
    E.openConv(mine.id, route.params.profileId, { name: route.params.name }).then((c) => setCid(c.id));
  }, [cid, me, route.params.profileId, route.params.name]);

  const tick = useTopics('convs', cid ? 'msgs:' + cid : 'none', cid ? 'typing:' + cid : 'none2');
  // R-07.19: chip only after 3 s offline, so a quick reconnect doesn't flash it.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (t) clearTimeout(t);
      t = null;
      if (E.isOnline()) setOffline(false);
      else t = setTimeout(() => setOffline(!E.isOnline()), Math.max(0, 3000 - (Date.now() - E.offlineSince())));
    };
    const off = E.on('net', check);
    t = setTimeout(check, 0);
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, []);
  const conv = cid ? E.getConv(cid) : undefined;
  const running = useCheckin();
  // F-20 R-20.8: Visiting label + one-time note (fetched, kept in memory 10 min).
  const peerTrip = usePeerTrip(conv && !conv.ctx && !conv.gone ? conv.peer : null);

  useEffect(() => {
    if (!cid) return;
    E.messages(cid).then(setList);
  }, [cid, tick]);

  // R-13.18: meetup prompt, matched on this phone only.
  const [cueOk, setCueOk] = useState<string | null>(null); // chat id whose cue is not dismissed
  const [hidden, setHidden] = useState(false);
  const cueHit = !!list && !!conv && !conv.ctx && !conv.gone && meetupCue(chatLines(list));
  useEffect(() => {
    if (!cid || !cueHit) return;
    let alive = true;
    cueDismissed(cid).then((d) => alive && setCueOk(d ? null : cid));
    return () => {
      alive = false;
    };
  }, [cid, cueHit]);
  const showCue = cueHit && cueOk === cid && !hidden && !running;

  useEffect(() => {
    if (cid) E.markRead(cid).catch(() => {});
  }, [cid, list?.length]);

  useEffect(() => {
    import('./quick').then((q) => q.customQuickReplies().then(setCustom));
  }, []);

  // Typing indicator expires after 6 s without a new event.
  const [, force] = useState(0);
  const typing = cid ? E.isTyping(cid) : false;
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => force((n) => n + 1), 6000);
    return () => clearTimeout(t);
  }, [typing, tick]);

  const visible = useMemo(() => {
    if (!list) return [];
    // F-19 G2: one reaction per person per message, the latest wins; an empty emoji takes it back.
    const by: Record<string, Record<string, string>> = {};
    for (const m of list) if (m.p.t === 'reaction') (by[m.p.to] ??= {})[m.from === 'me' ? 'me' : (m.by ?? 'them')] = m.p.emoji;
    return list
      .filter((m) => !HIDDEN.has(m.p.t))
      .map((m) => ({ m, r: Object.values(by[m.id] ?? {}).filter(Boolean), mineR: by[m.id]?.me ?? '' }))
      .reverse();
  }, [list]);

  const lastMine = visible.find((x) => x.m.from === 'me')?.m.id;
  // R-07.36: only the latest request row is live (Accept / Pending); older ones are a plain line.
  const lastReq = visible.find((x) => x.m.p.t === 'friend' && x.m.p.op === 'request')?.m.id;
  const hits = useMemo(() => findHits(visible, find), [visible, find]);
  const hitSet = useMemo(() => new Set(hits), [hits]);
  const cur = hits[Math.min(hitAt, hits.length - 1)];
  useEffect(() => {
    if (cur !== undefined) listRef.current?.scrollToIndex({ index: cur, viewPosition: 0.5, animated: true });
  }, [cur]);

  const send = useCallback(
    async (p: E.Payload) => {
      if (!conv) return;
      const why = E.firstMessageProblem(conv, p);
      if (why) {
        setProblem(tx.chat.first[why]);
        return;
      }
      if (!conv.theyWrote && !me.verified) {
        setProblem(tx.chat.unverified);
        return;
      }
      setProblem(null);
      try {
        await E.send(conv.id, p);
      } catch (e) {
        setProblem(errorText(e));
      }
    },
    [conv, me.verified],
  );

  if (!cid || !conv || !list) return <Loading />;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    send(reply ? { t: 'text', text: t, re: reply.re } : { t: 'text', text: t });
    setReply(null);
  };

  // F-19 G1: start a reply to `m` (swipe right, hold menu, screen reader action).
  const startReply = (m: E.Msg) => {
    const n = m.from === 'me' ? me.profile?.display_name ?? gx.you : group ? who(m) : conv.name;
    setReply({ re: { id: m.id, n, s: (E.preview(m.p) || gx.photo).slice(0, 80) }, mine: m.from === 'me' });
    setHeld(null);
    setTray(false);
  };
  const react = (m: E.Msg, emoji: string, mineR: string) => {
    feel('tap');
    send({ t: 'reaction', to: m.id, emoji: emoji === mineR ? '' : emoji });
    setHeld(null);
  };
  const barAt = (h: Hold & { m: E.Msg }) => {
    const W = Dimensions.get('window').width;
    const mine = h.m.from === 'me';
    const x = mine ? W - space.l - BAR_W : space.l;
    const top = h.top - rootY;
    const y = top - BAR_H - space.s < insets.top + 8 ? top + h.height + space.s : top - BAR_H - space.s;
    return { x, y, top };
  };
  const holdEnd = (fx: number, fy: number) => {
    const h = heldRef.current;
    if (!h) return;
    const { x, y } = barAt(h);
    const i = hitSlot(fx, fy, x, y + rootY, BAR_W / REACTIONS.length, REACTIONS.length);
    if (i >= 0) {
      const row = visible.find((v) => v.m.id === h.m.id);
      react(h.m, REACTIONS[i], row?.mineR ?? '');
    }
  };
  // Quoted message above a reply (F-19 G1). Tapping it scrolls to the original when it is still here.
  const quoteOf = (m: E.Msg, mine: boolean) => {
    if (m.p.t !== 'text' || !m.p.re) return null;
    const re = m.p.re;
    const orig = visible.findIndex((v) => v.m.id === re.id);
    const name = orig >= 0 ? (visible[orig].m.from === 'me' ? gx.you : group ? who(visible[orig].m) : conv.name) : re.n;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${gx.replyingTo(name)}: ${re.s}`}
        onPress={orig >= 0 ? () => listRef.current?.scrollToIndex({ index: orig, viewPosition: 0.5, animated: true }) : undefined}
        style={{ borderLeftWidth: 3, borderColor: mine ? color.onAccent : color.friends, paddingLeft: space.s, paddingVertical: 2, marginBottom: 4, opacity: 0.85 }}
      >
        <Text style={{ ...type.caption, color: mine ? color.onAccent : color.friends }} numberOfLines={1}>{name}</Text>
        <Text style={{ ...type.meta, color: mine ? color.onAccent : color.fgSecondary }} numberOfLines={2}>{re.s}</Text>
      </Pressable>
    );
  };

  const ttlLabel = tx.chat.ttl[conv.ttl];
  const trMode = modeFor(conv);
  const trCan = translateAvailable() && prefs().translate !== 'off';
  // Group chats (party / activity / club): no single peer, sender names from the E2EE payload.
  const group = !!conv.ctx;
  const fav = !group && P.isFav(conv.peer);
  const tripNote = peerTrip && !peerTrip.here && daysUntil(peerTrip.first_day) > 0 ? tr.chatNote(conv.name, peerTrip.city, rangeLabel(peerTrip.first_day, peerTrip.last_day)) : null;
  const friend = group ? null : P.friendOf(conv.peer);
  const askFriend = () => {
    if (!me.verified) {
      setProblem(tx.chat.unverified);
      return;
    }
    E.requestFriend(conv.id).catch((e) => setProblem(errorText(e)));
  };
  const who = (m: E.Msg) => (m.from === 'me' ? tx.chat.you : group ? (m.by && conv.names?.[m.by]) || '…' : conv.name);

  const chatSettings = (
    <>
      <ListRow testID="menu-find" title={ppl.find} onPress={() => { setMenu(false); setHitAt(0); setFind(''); }} />
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.chat.disappearing}</Text>
          <Segmented
            label={tx.chat.disappearing}
            value={conv.ttl}
            options={(['24h', '7d', 'never'] as E.Ttl[]).map((v) => ({ value: v, label: tx.chat.ttl[v] }))}
            onChange={(v) => {
              if (v !== conv.ttl) send({ t: 'disappearing', ttl: v });
            }}
          />
        </View>
        <View>
          {trCan ? (
            <Toggle
              label={trx.chat}
              sub={trFrom ? trx.chatSub(langName(trFrom), langName(targetLang())) : trx.chatSubAny}
              value={conv.translate !== 'off'}
              onChange={(v) => E.setConv(conv.id, { translate: v ? undefined : 'off' })}
            />
          ) : null}
          <Toggle
            label={tx.chat.chatReceipts}
            sub={me.settings?.read_receipts === false ? tx.chat.chatReceiptsGlobalOff : tx.chat.chatReceiptsSub}
            value={me.settings?.read_receipts !== false && conv.receipts !== 'off'}
            disabled={me.settings?.read_receipts === false}
            onChange={(v) => E.setConv(conv.id, { receipts: v ? undefined : 'off' })}
          />
          <ListRow title={conv.muted ? tx.chat.unmute : tx.chat.mute} onPress={() => E.setConv(conv.id, { muted: !conv.muted })} />
          {!group && conv.gone ? (
            <ListRow
              title={tx.chat.report}
              danger
              onPress={() => {
                setMenu(false);
                navigation.navigate('Report', { profileId: conv.peer, cid: conv.id });
              }}
            />
          ) : null}
          <ListRow
            title={tx.chat.deleteChat}
            danger
            onPress={() => E.deleteConv(conv.id).then(() => { setMenu(false); navigation.goBack(); })}
          />
        </View>
    </>
  );
  const q = hits.length ? find : null;
  type Row = { m: E.Msg; r: string[]; mineR: string };
  // F-19 G1–G4: every real message gets the row gestures; `plain` = the lifted copy shown while holding.
  const wrap = (row: Row, el: React.ReactElement, plain: boolean) =>
    plain ? (
      el
    ) : (
      <MsgRow
        mine={row.m.from === 'me'}
        at={row.m.at}
        g={g}
        onReply={() => startReply(row.m)}
        onHeart={row.m.from === 'them' ? () => react(row.m, '❤️', row.mineR) : undefined}
        onHold={(h) => {
          feel('tap');
          setHeld({ ...h, m: row.m });
        }}
        onHoldEnd={holdEnd}
        a11yMore={() => setHeld({ m: row.m, top: rootY + 200, height: 0 })}
      >
        {el}
      </MsgRow>
    );
  const renderRow = (row: Row, ring: boolean, plain = false) => {
    const { m, r } = row;
          if (m.p.t === 'notice') {
            return (
              <View testID={`notice-${m.p.kind}`} style={{ alignSelf: 'center', maxWidth: '86%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.m, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: color.bgRaised, marginVertical: space.s }}>
                <Icon.Lock />
                <Text style={{ ...type.caption, color: color.fgSecondary, flexShrink: 1 }}>{m.p.kind === 'expired' ? tx.chat.expired(m.p.n ?? 1) : tx.chat.undecryptable}</Text>
              </View>
            );
          }
          if (m.p.t === 'vcheck') {
            if (group) return null;
            return <VcRow m={m} conv={conv} onRecord={(v) => setVcRec({ rid: v.rid, move: v.move })} onWatch={setVcWatch} />;
          }
          if (m.p.t === 'friend') {
            // R-07.36 friend request / accepted.
            if (m.p.op === 'accept') {
              return (
                <View testID="friend-yes" style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: `${color.friends}24`, marginVertical: space.s }}>
                  <Icon.Check size={14} c={color.friends} />
                  <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.friends }}>{ppl.nowFriends(conv.name)}</Text>
                </View>
              );
            }
            const live = m.id === lastReq && ((m.from === 'me' && friend === 'out') || (m.from === 'them' && friend === 'in'));
            if (!live) {
              return <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center', marginVertical: space.s }}>{ppl.oldRequest}</Text>;
            }
            return (
              <View testID={m.from === 'me' ? 'friend-pending' : 'friend-ask'} style={{ alignSelf: 'stretch', marginVertical: space.s, padding: space.l, borderRadius: radius.md, backgroundColor: `${color.friends}1F`, alignItems: 'center', gap: space.s }}>
                <Icon.UserPlus size={26} />
                <Text style={{ ...type.headline, fontSize: 15, color: color.friends, textAlign: 'center' }}>{m.from === 'me' ? ppl.youAsked(conv.name) : ppl.askedYou(conv.name)}</Text>
                {m.from === 'me' ? (
                  <Text style={{ ...type.meta, color: color.fgSecondary, textAlign: 'center' }}>{ppl.pending}</Text>
                ) : (
                  <View style={{ flexDirection: 'row', gap: space.s, marginTop: space.xs }}>
                    <Pressable testID="friend-no" accessibilityRole="button" onPress={() => E.answerFriend(conv.id, false)} style={{ height: 40, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: color.bgOverlay, justifyContent: 'center' }}>
                      <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgPrimary }}>{ppl.notNow}</Text>
                    </Pressable>
                    <Pressable testID="friend-accept" accessibilityRole="button" onPress={() => E.answerFriend(conv.id, true)} style={{ height: 40, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: color.friends, justifyContent: 'center' }}>
                      <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{ppl.accept}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          }
          if (m.p.t === 'disappearing') {
            return (
              <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center', marginVertical: space.s }}>
                {tx.chat.ttlChanged(who(m), tx.chat.ttl[m.p.ttl])}
              </Text>
            );
          }
          const mine = m.from === 'me';
          // R-07.25: incoming text and custom quick replies are translated on this phone.
          if (!mine && (m.p.t === 'text' || (m.p.t === 'quick_reply' && m.p.k === undefined))) {
            return (
              wrap(
                row,
                <TranslatedText
                  cid={cid}
                  id={m.id}
                  text={m.p.text}
                  mode={trMode}
                  sender={group ? who(m) : null}
                  senderColor={accent}
                  reactions={r}
                  quote={quoteOf(m, false)}
                  onTranslated={onTranslated}
                  mark={q}
                  ring={ring}
                />,
                plain,
              )
            );
          }
          if (m.p.t === 'album.grant') {
            // R-08.16 album card (no bubble around it).
            const ag = m.p;
            return wrap(
              row,
              <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', gap: 2 }}>
                <AlbumCard p={ag} mine={mine} conv={conv} onOpen={() => navigation.navigate('Album', { cid, album: ag.album })} />
                {r.length ? <Text style={{ ...type.meta }}>{r.join('')}</Text> : null}
              </View>,
              plain,
            );
          }
          return wrap(
            row,
            <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
              <Pressable
                testID={ring ? 'find-current' : `msg-${m.id}`}
                onPress={() => {
                  if (m.status === 'failed') E.retry(cid, m.id).catch((e) => setProblem(errorText(e)));
                  else if (m.p.t === 'album.grant' && m.from === 'them') navigation.navigate('Album', { cid, album: m.p.album });
                }}
                style={{
                  maxWidth: '80%',
                  paddingHorizontal: space.m,
                  paddingVertical: 10,
                  borderRadius: 20,
                  borderBottomRightRadius: mine ? 6 : 20,
                  borderBottomLeftRadius: mine ? 20 : 6,
                  backgroundColor: mine ? accent : color.bgRaised,
                  borderWidth: ring ? 2 : 0,
                  borderColor: color.personal,
                  opacity: m.status === 'sending' ? 0.7 : 1,
                }}
              >
                {group && !mine ? <Text style={{ ...type.caption, color: accent }}>{who(m)}</Text> : null}
                {quoteOf(m, mine)}
                <Bubble m={m} mine={mine} cid={cid} conv={conv} mark={q} />
              </Pressable>
              {r.length ? <Text style={{ ...type.meta, marginTop: -4 }}>{r.join('')}</Text> : null}
              {mine && (m.id === lastMine || m.status === 'failed') ? (
                <Text style={{ ...type.caption, color: m.status === 'failed' ? color.danger : color.fgMuted, marginTop: 2 }}>
                  {statusText(m, group)}
                </Text>
              ) : null}
            </View>,
            plain,
          );
  };
  // R-07.39: while searching, non-matches dim and the current match gets a sunflower ring.
  const findWrap = (index: number, el: React.ReactNode) => {
    if (find === null || !hits.length) return el;
    const hit = hitSet.has(index);
    return (
      <View style={{ opacity: hit ? 1 : 0.35 }}>
        {el}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.bgBase }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View ref={anchor} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} onLayout={() => anchor.current?.measureInWindow((_x, y) => setRootY(y))} />
      {find !== null ? (
        <View style={{ paddingTop: insets.top + space.xs, paddingHorizontal: space.m, paddingBottom: space.s, flexDirection: 'row', alignItems: 'center', gap: space.s, borderBottomWidth: 1, borderColor: color.lineSubtle }}>
          <View style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: color.bgRaised, borderWidth: 2, borderColor: color.personal, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: 14 }}>
            <Icon.Search c={color.personal} />
            <TextInput
              testID="find-input"
              autoFocus
              value={find}
              onChangeText={(v) => {
                setFind(v);
                setHitAt(0);
              }}
              placeholder={ppl.findPh}
              placeholderTextColor={color.fgMuted}
              accessibilityLabel={ppl.findPh}
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => setHitAt((i) => (hits.length ? (i + 1) % hits.length : 0))}
              style={{ flex: 1, color: color.fgPrimary, fontFamily: font.regular, fontSize: 15, paddingVertical: 0, outlineStyle: 'none' as never }}
            />
          </View>
          <Pressable testID="find-done" accessibilityRole="button" onPress={() => setFind(null)} hitSlop={8} style={{ height: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
            <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{tx.common.done}</Text>
          </Pressable>
        </View>
      ) : (
      <View style={{ paddingTop: insets.top + space.xs, paddingHorizontal: space.l, paddingBottom: space.s, flexDirection: 'row', alignItems: 'center', gap: space.s, borderBottomWidth: 1, borderColor: color.lineSubtle }}>
        <Pressable accessibilityRole="button" accessibilityLabel={tx.common.back} onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon.Back />
        </Pressable>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flex: 1 }} accessibilityRole="button" onPress={() => !conv.gone && !group && navigation.navigate('Profile', { id: conv.peer })}>
          <Photo uri={conv.photo} id={conv.peer || conv.id} label="" style={{ width: 42, height: 42, borderRadius: 21 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text numberOfLines={1} style={{ ...type.headline, color: color.fgPrimary, flexShrink: 1 }}>
                {conv.gone ? tx.chat.gone : conv.name}
              </Text>
              {conv.verified ? <VerifiedTick size={13} /> : null}
              {!group && P.friendOf(conv.peer) === 'yes' ? (
                <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.friends }}>
                  <Text style={{ ...type.caption, color: color.onAccent }}>{ppl.friend}</Text>
                </View>
              ) : null}
            </View>
            {!group ? <VcBadge peer={conv.peer} /> : null}
            {/* F-20 R-20.8 */}
            {peerTrip ? <TravelLabel small text={shortLabel(peerTrip)} a11y={a11yLabel(peerTrip)} /> : null}
            {offline ? (
              <View testID="chat-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.fgMuted }} />
                <Text numberOfLines={1} style={{ ...type.meta, color: color.fgMuted, flexShrink: 1 }}>{tx.chat.waiting}</Text>
              </View>
            ) : typing ? (
              <Text style={{ ...type.meta, color: accent }}>{tx.chat.typing}</Text>
            ) : null}
          </View>
        </Pressable>
        {conv.ttl !== 'never' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={tx.chat.disappearing} onPress={() => setMenu(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 28, borderRadius: radius.pill, backgroundColor: color.personal }}>
            <Icon.Timer />
            {/* #115: compact (24h / 7d) so name, favorite and ⋯ fit the header. */}
            <Text style={{ ...type.caption, color: color.onAccent }}>{group ? ttlLabel : conv.ttl}</Text>
          </Pressable>
        ) : null}
        {!group && !conv.gone ? (
          <Pressable
            testID="chat-fav"
            accessibilityRole="button"
            accessibilityLabel={fav ? ppl.removeFav : ppl.addFav}
            accessibilityState={{ selected: fav }}
            onPress={() => P.setFav(conv.peer, !fav, { name: conv.name, photo: conv.photo })}
            hitSlop={2}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: fav ? color.personal : color.bgRaised, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}
          >
            <Icon.Star size={21} c={fav ? color.onAccent : color.fgPrimary} fill={fav ? color.onAccent : 'none'} />
          </Pressable>
        ) : null}
        {!group && !conv.gone ? <ChatShield cid={conv.id} navigation={navigation} /> : null}
        <Pressable testID="chat-menu" accessibilityRole="button" accessibilityLabel="More" onPress={() => setMenu(true)} hitSlop={2} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.More />
        </Pressable>
      </View>
      )}
      {!group && find === null ? <NoteStrip peer={conv.peer} onPress={() => setNoteOpen(true)} /> : null}
      {tripNote && find === null ? (
        <View testID="trip-note" style={{ alignSelf: 'center', maxWidth: '92%', marginTop: space.s, paddingHorizontal: space.m, paddingVertical: 7, borderRadius: 14, backgroundColor: color.bgRaised }}>
          <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary, textAlign: 'center' }}>{tripNote}</Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        inverted
        // #134: dragging the messages closes the keyboard.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        data={visible}
        keyExtractor={(x) => x.m.id}
        // SR-15 / EN-18: render the newest screenful first, then small batches while scrolling.
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={{ padding: space.l, gap: space.xs }}
        ListFooterComponent={
          <View style={{ alignItems: 'center', gap: space.s, marginBottom: space.l }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.m, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: color.bgRaised }}>
              <Icon.Lock />
              <Text style={{ ...type.caption, color: color.trust }}>{group ? tx.group.e2ee : tx.chat.e2ee}</Text>
            </View>
            {trFrom ? (
              <View testID="tr-note" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, maxWidth: 300, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16, backgroundColor: `${color.trust}1F` }}>
                <Icon.Translate size={18} w={2} />
                <Text style={{ ...type.caption, fontSize: 12, lineHeight: 16, fontFamily: font.medium, color: color.fgSoft, flexShrink: 1 }}>{trx.note(langName(trFrom), langName(targetLang()))}</Text>
              </View>
            ) : null}
          </View>
        }

        renderItem={({ item, index }) => findWrap(index, renderRow(item, find !== null && index === cur))}
        onScrollToIndexFailed={(e) => setTimeout(() => listRef.current?.scrollToIndex({ index: e.index, viewPosition: 0.5, animated: true }), 200)}
      />

      {showCue ? <MeetupCard cid={conv.id} name={conv.name} navigation={navigation} onHide={() => setHidden(true)} /> : null}
      {!showCue && !group && (me.safe_mode_active || me.safe_mode === 'on') && list && careful(conv, list) ? (
        <View style={{ paddingHorizontal: space.l }}>
          <Banner testID="careful" tone="warn" text={tx.safeMode.careful} onPress={() => navigation.navigate('CheckinStart', { cid: conv.id })} />
        </View>
      ) : null}
      {group && !conv.groups.length ? (
        <View style={{ paddingHorizontal: space.l }}>
          <Banner tone="trust" text={conv.host ? tx.group.sync : tx.group.pending} />
        </View>
      ) : null}
      {problem ? (
        <View style={{ paddingHorizontal: space.l }}>
          <Banner tone="warn" text={problem} onPress={() => (problem === tx.chat.unverified ? navigation.navigate('Verify') : setProblem(null))} />
        </View>
      ) : null}

      {find !== null ? (
        <View testID="find-bar" style={{ paddingHorizontal: space.m, paddingTop: 10, paddingBottom: navBottom + space.s, borderTopWidth: 1, borderColor: color.lineSubtle, backgroundColor: color.bgMap, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text testID="find-count" style={{ ...type.headline, color: color.fgPrimary }}>
              {(find ?? '').trim().length < 2 ? ppl.findHint : hits.length ? ppl.findCount(Math.min(hitAt, hits.length - 1) + 1, hits.length) : ppl.findNone}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon.Lock size={11} />
              <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted }}>{ppl.findLocal}</Text>
            </View>
          </View>
          {(
            [
              { label: ppl.findOlder, d: 'M6 15l6-6 6 6', on: () => setHitAt((i) => Math.min(hits.length - 1, i + 1)), off: hitAt >= hits.length - 1 },
              { label: ppl.findNewer, d: 'M6 9l6 6 6-6', on: () => setHitAt((i) => Math.max(0, i - 1)), off: hitAt <= 0 },
            ] as const
          ).map((b) => (
            <Pressable
              key={b.label}
              accessibilityRole="button"
              accessibilityLabel={b.label}
              accessibilityState={{ disabled: b.off || !hits.length }}
              onPress={b.off || !hits.length ? undefined : b.on}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center', opacity: b.off || !hits.length ? 0.4 : 1 }}
            >
              <Icon.Chevron d={b.d} />
            </Pressable>
          ))}
        </View>
      ) : !conv.gone ? (
        <>
          {!group ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s }}>
              {[...tx.chat.quick, ...custom].map((q, i) => (
                <Pressable key={q + i} accessibilityRole="button" onPress={() => send(i < tx.chat.quick.length ? { t: 'quick_reply', text: q, k: i } : { t: 'quick_reply', text: q })} style={{ paddingHorizontal: 14, height: 36, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: color.bgRaised }}>
                  <Text style={{ ...type.meta, color: color.fgPrimary, fontFamily: font.medium }}>{q}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {reply ? (
            // F-19 G1: the message being answered, above the composer. ✕ cancels.
            <View testID="reply-bar" style={{ marginHorizontal: space.l, marginBottom: space.xs, paddingVertical: space.s, paddingLeft: space.m, paddingRight: space.xs, borderRadius: radius.sm, backgroundColor: color.bgRaised, borderLeftWidth: 3, borderColor: color.friends, flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.caption, color: color.friends }} numberOfLines={1}>{gx.replyingTo(reply.mine ? gx.you : reply.re.n)}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }} numberOfLines={1}>{reply.re.s}</Text>
              </View>
              <Pressable testID="reply-cancel" accessibilityRole="button" accessibilityLabel={gx.cancelReply} onPress={() => setReply(null)} hitSlop={8} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                <Icon.Close size={16} c={color.fgSecondary} />
              </Pressable>
            </View>
          ) : null}
          {/* #134: no home-indicator inset while the keyboard is up (it would leave a gap above the keys). */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.s, paddingHorizontal: space.l, paddingBottom: (tray ? 0 : navBottom) + space.s }}>
            {conv.theyWrote ? (
              <Pressable
                testID="chat-attach"
                accessibilityRole="button"
                accessibilityLabel={tray ? mx.close : mx.tray}
                disabled={busy}
                accessibilityState={{ expanded: tray }}
                onPress={() => {
                  if (!tray) Keyboard.dismiss();
                  setTray((v) => !v);
                }}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tray ? color.bgInverse : color.bgRaised, alignItems: 'center', justifyContent: 'center' }}
              >
                {busy ? <Text style={{ ...type.headline, color: tray ? color.onAccent : color.fgPrimary }}>…</Text> : tray ? <Icon.Close c={color.onAccent} /> : <Icon.Plus />}
              </Pressable>
            ) : null}
            <TextInput
              testID="chat-input"
              ref={input}
              value={text}
              onFocus={() => setTray(false)}
              onChangeText={(v) => {
                setText(v);
                E.sendTyping(cid);
              }}
              placeholder={tx.chat.placeholder}
              placeholderTextColor={color.fgMuted}
              multiline
              maxLength={4000}
              onSubmitEditing={submit}
              blurOnSubmit={false}
              onKeyPress={(e) => {
                const ev = e.nativeEvent as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ev.key === 'Enter' && !ev.shiftKey) {
                  (e as unknown as { preventDefault: () => void }).preventDefault();
                  submit();
                }
              }}
              style={{ flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 22, outlineStyle: 'none' as never, backgroundColor: color.bgRaised, color: color.fgPrimary, paddingHorizontal: space.m, paddingTop: 12, paddingBottom: 12, fontFamily: font.regular, fontSize: 15 }}
            />
            <Pressable
              testID="chat-send"
              accessibilityRole="button"
              accessibilityLabel={tx.chat.send}
              onPress={submit}
              disabled={!text.trim()}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: text.trim() ? accent : color.bgRaised, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon.Send c={text.trim() ? color.onAccent : color.fgMuted} />
            </Pressable>
          </View>
          {tray && conv.theyWrote ? (
            <MediaTray
              conv={conv}
              height={Math.min(Math.max(kbH, 320), Math.round(Dimensions.get('window').height * 0.45))}
              bottom={insets.bottom}
              onSend={(items, opts) => {
                setTray(false);
                setBusy(true);
                sendPhotos(conv, items, opts)
                  .then((failed) => {
                    if (failed) setProblem(mx.failed(failed));
                  })
                  .finally(() => setBusy(false));
              }}
              onAlbumError={() => setProblem(tx.common.error)}
              onEditAlbum={(id) => {
                setTray(false);
                navigation.navigate('AlbumEdit', { id });
              }}
            />
          ) : null}
        </>
      ) : (
        <Text style={{ ...type.meta, color: color.fgMuted, textAlign: 'center', padding: space.l, paddingBottom: navBottom + space.l }}>{tx.chat.gone}</Text>
      )}

      {group || conv.gone ? (
        <Sheet visible={menu} onClose={() => setMenu(false)} title={conv.name} closeLabel={tx.common.close}>
          {chatSettings}
        </Sheet>
      ) : (
        // #111 S-51: 1:1 chat ⋯ = shared Hide / Block / Report sheet, chat settings below.
        <SafetySheet
          visible={menu}
          target={{ id: conv.peer, name: conv.name, age: conv.age }}
          onClose={() => setMenu(false)}
          onReport={(t) => navigation.navigate('Report', { profileId: t.id, cid: conv.id })}
          onGone={(kind) => {
            if (kind === 'block') E.setConv(conv.id, { archived: true }).finally(() => navigation.goBack());
          }}
          lead={
            <>
              <SheetRow title={tx.chat.viewProfile} onPress={() => { setMenu(false); navigation.navigate('Profile', { id: conv.peer }); }} />
              <SheetRow testID="menu-fav" title={fav ? ppl.removeFav : ppl.addFav} onPress={() => P.setFav(conv.peer, !fav, { name: conv.name, photo: conv.photo }).then(() => setMenu(false))} />
              {friend === 'in' ? (
                <SheetRow testID="menu-friend" title={ppl.acceptFriend} onPress={() => E.answerFriend(conv.id, true).then(() => setMenu(false))} />
              ) : friend ? (
                <SheetRow testID="menu-friend" title={friend === 'out' ? ppl.cancelRequest : ppl.removeFriend} onPress={() => E.dropFriend(conv.id).then(() => setMenu(false))} />
              ) : P.canAsk(conv.peer) && (conv.iWrote || conv.theyWrote) ? (
                <SheetRow testID="menu-friend" title={ppl.addFriend} onPress={() => { setMenu(false); askFriend(); }} />
              ) : null}
              <SheetRow testID="menu-note" title={P.noteFor(conv.peer) ? ppl.editNote : ppl.addNote} onPress={() => { setMenu(false); setNoteOpen(true); }} />
              {vcAvailable && (conv.iWrote || conv.theyWrote) && V.canAsk(conv.peer) ? (
                <SheetRow
                  testID="menu-vcheck"
                  title={vcx.menu(conv.name)}
                  onPress={() => {
                    setMenu(false);
                    if (!me.verified) setProblem(vcx.verifyFirst);
                    else setVcAsk(true);
                  }}
                />
              ) : null}
              <SheetRow last testID="chat-checkin" title={tx.safety.checkin} onPress={() => { setMenu(false); navigation.navigate('CheckinStart', { cid: conv.id }); }} />
            </>
          }
          after={chatSettings}
        />
      )}

      {!group ? <NoteSheet peer={conv.peer} visible={noteOpen} onClose={() => setNoteOpen(false)} /> : null}
      {!group && vcAvailable ? (
        <>
          <VcAskSheet key={vcAsk ? 'open' : 'shut'} conv={conv} visible={vcAsk} onClose={() => setVcAsk(false)} onRecordMine={(rid, move) => setVcRec({ rid, move, offer: true })} />
          <VcRecorder key={vcRec?.rid ?? 'none'} conv={conv} rec={vcRec} onClose={() => setVcRec(null)} />
          <VcViewer key={vcWatch?.rid ?? 'none'} conv={conv} v={vcWatch} onClose={() => setVcWatch(null)} onReport={() => navigation.navigate('Report', { profileId: conv.peer, cid: conv.id })} />
        </>
      ) : null}

      {held
        ? (() => {
            const row = visible.find((v) => v.m.id === held.m.id);
            if (!row) return null;
            const { x, y, top } = barAt(held);
            const m = held.m;
            const canCopy = m.p.t === 'text' || m.p.t === 'quick_reply';
            const below = Math.max(y + BAR_H, top + held.height) + space.s;
            const acts = [
              { k: 'reply', label: gx.reply, icon: <Icon.Reply />, on: () => startReply(m) },
              ...(canCopy
                ? [{ k: 'copy', label: gx.copy, icon: <Icon.Copy />, on: () => { Clipboard.setStringAsync(E.preview(m.p)).then(() => toast(gx.copied), () => {}); setHeld(null); } }]
                : []),
              ...(m.from === 'them'
                ? [{ k: 'report', label: tx.chat.report, icon: <Icon.Flag c={color.danger} />, danger: true, on: () => { setHeld(null); navigation.navigate('Report', { profileId: m.by ?? conv.peer, cid: conv.id, messageIds: [m.id] }); } }]
                : []),
              { k: 'delete', label: tx.chat.deleteForMe, icon: <Icon.Trash c={color.danger} />, danger: true, on: () => E.deleteMessage(cid, m.id).then(() => setHeld(null)) },
            ];
            return (
              // F-19 G3: the held message lifts over a dimmed chat; reactions above, actions below. Tap outside closes.
              <View testID="msg-held" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} accessibilityViewIsModal onAccessibilityEscape={() => setHeld(null)}>
                <Pressable style={{ flex: 1, backgroundColor: color.scrim }} onPress={() => setHeld(null)} accessibilityRole="button" accessibilityLabel={tx.common.close} />
                {held.height ? (
                  <View pointerEvents="none" style={{ position: 'absolute', left: space.l, right: space.l, top, transform: [{ scale: 1.03 }] }}>
                    {renderRow(row, false, true)}
                  </View>
                ) : null}
                <ReactionBar emojis={REACTIONS} x={x} y={y} oy={rootY} w={BAR_W} g={g} onPick={(e) => react(m, e, row.mineR)} />
                <View style={{ position: 'absolute', top: Math.min(below, Dimensions.get('window').height - rootY - 4 * 48 - navBottom - space.l), [m.from === 'me' ? 'right' : 'left']: space.l, width: 220, borderRadius: radius.md, backgroundColor: color.bgOverlay, overflow: 'hidden' }}>
                  {acts.map((a, i) => (
                    <Pressable
                      key={a.k}
                      testID={`held-${a.k}`}
                      accessibilityRole="button"
                      onPress={a.on}
                      style={({ pressed }) => ({ height: 48, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: pressed ? color.bgRaised : 'transparent', borderTopWidth: i ? 1 : 0, borderColor: color.line })}
                    >
                      {a.icon}
                      <Text style={{ ...type.body, fontFamily: font.medium, color: 'danger' in a && a.danger ? color.danger : color.fgPrimary }}>{a.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })()
        : null}
    </KeyboardAvoidingView>
  );
}

function Bubble({ m, mine, cid, conv, mark }: { m: E.Msg; mine: boolean; cid: string; conv: E.Conv; mark?: string | null }) {
  const fg = mine ? color.onAccent : color.fgPrimary;
  switch (m.p.t) {
    case 'text':
      return <Marked style={{ ...type.body, color: fg }} text={m.p.text} q={mark} onAccent={mine} />;
    case 'quick_reply':
      // R-07.31: built-in quick replies show in the reader's own language.
      return <Marked style={{ ...type.body, color: fg }} text={(m.p.k !== undefined && tx.chat.quick[m.p.k]) || m.p.text} q={mark} onAccent={mine} />;
    case 'media':
      return <MediaBubble m={m} media={m.p.media} mine={mine} cid={cid} conv={conv} />;
    case 'album.grant':
      return <Text style={{ ...type.body, color: fg }}>🔓 {tx.chat.album}: {m.p.name}</Text>;
    case 'album.revoke':
      return <Text style={{ ...type.body, color: fg }}>🔒 {tx.chat.albumRevoked}</Text>;
    case 'location.share':
      return <Text style={{ ...type.body, color: fg }}>📍 {tx.chat.location}</Text>;
    case 'screenshot':
      return <Text style={{ ...type.meta, color: fg }}>📸 {mine ? tx.chat.you : conv.name} {tx.chat.screenshot}</Text>;
    default:
      return <Text style={{ ...type.body, color: fg }}>{E.preview(m.p)}</Text>;
  }
}

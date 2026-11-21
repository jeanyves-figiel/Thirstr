// F-08 R-08.16 album card in chat: mosaic of the first items (decrypted on the phone with the granted
// keys), name, counts, time left; receiver "Open album", sender "Stop sharing".
import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { useSession } from '../app/session';
import { mx, timeLeft } from '../i18n/media';
import { color, font, radius, space, tileFor, type } from '../theme/tokens';
import { Icon } from '../ui';
import * as Albums from './albums';
import * as E from './engine';
import { useTopics } from './hooks';
import { decryptToUri, strangerPolicy } from './media';
import { isVideo } from './video';
import { VideoMark } from './VideoPlayer';

type Grant = Extract<E.Payload, { t: 'album.grant' }>;
const W = 232;

function Tile({ item, w, h, blur, more }: { item?: E.AlbumItem; w: number; h: number; blur: boolean; more?: number }) {
  const [uri, setUri] = useState<string | null>(null);
  const video = !!item && isVideo(item);
  useEffect(() => {
    if (item && !video) decryptToUri(item).then(setUri, () => {});
  }, [item, video]);
  return (
    <View style={{ width: w, height: h, backgroundColor: item && !video ? tileFor(item.blob) : color.bgOverlay, overflow: 'hidden' }}>
      {uri ? <Image source={{ uri }} style={{ width: w, height: h }} blurRadius={blur ? 30 : 0} resizeMode="cover" /> : null}
      {video && !more ? <VideoMark dur={item?.dur} small /> : null}
      {more ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: color.scrim }}>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>+{more}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function Mosaic({ items, blur }: { items: E.AlbumItem[]; blur: boolean }) {
  const inner = W - 12;
  const big = Math.round(inner * 0.64);
  const small = inner - big - 3;
  const h = 128;
  return (
    <View style={{ flexDirection: 'row', gap: 3, height: h, borderRadius: 16, overflow: 'hidden' }}>
      <Tile item={items[0]} w={items.length > 1 ? big : inner} h={h} blur={blur} />
      {items.length > 1 ? (
        <View style={{ gap: 3 }}>
          <Tile item={items[1]} w={small} h={items.length > 2 ? (h - 3) / 2 : h} blur={blur} />
          {items.length > 2 ? <Tile item={items[2]} w={small} h={(h - 3) / 2} blur={blur} more={items.length > 3 ? items.length - 3 : undefined} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Locked({ text, mine }: { text: string; mine: boolean }) {
  return (
    <View testID="album-card-locked" style={{ alignSelf: mine ? 'flex-end' : 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: color.bgRaised }}>
      <Icon.Lock size={13} c={color.fgMuted} />
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{text}</Text>
    </View>
  );
}

const clock = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function AlbumCard({ p, mine, conv, onOpen, onLongPress }: { p: Grant; mine: boolean; conv: E.Conv; onOpen: () => void; onLongPress?: () => void }) {
  const { me } = useSession();
  // Live state, not the message copy: a later grant (new time, new items) or a revoke updates every card.
  const [state, setState] = useState<{ items: E.AlbumItem[]; name: string; until?: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const tick = useTopics('msgs:' + conv.id);
  useEffect(() => {
    let on = true;
    const load = async () => {
      if (mine) {
        const a = (await Albums.listAlbums()).find((x) => x.id === p.album);
        const s = a?.shares.find((x) => x.cid === conv.id);
        if (on) setState(a && s ? { items: a.items, name: a.name, until: s.until } : null);
      } else {
        const g = await Albums.receivedGrant(conv.id, p.album);
        if (on) setState(g ? { items: g.items, name: g.name, until: g.until } : null);
      }
    };
    load();
    const off = Albums.onAlbums(load);
    return () => {
      on = false;
      off();
    };
  }, [mine, p.album, conv.id, p, tick]);

  if (state === undefined) return <View style={{ height: 40 }} />;
  const ended = !!p.until && p.until < now;
  if (!state || (state.until && state.until < now)) return <Locked mine={mine} text={ended || state ? mx.ended : mx.noLonger} />;

  const videos = state.items.filter(isVideo).length;
  const n = mx.countsPV(state.items.length - videos, videos);
  const blur = !mine && strangerPolicy(conv, me.settings?.explicit_from_strangers) !== 'show';
  const when = state.until ? (mine ? mx.until(clock(state.until)) : mx.left(timeLeft(state.until))) : mine ? mx.untilYouStop : mx.untilStop;
  return (
    <Pressable
      testID={mine ? 'album-card-mine' : 'album-card'}
      accessibilityRole="button"
      accessibilityLabel={`${state.name}, ${n}, ${when}`}
      onPress={mine ? undefined : onOpen}
      onLongPress={onLongPress}
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        width: W,
        padding: 6,
        gap: 8,
        borderRadius: 22,
        borderBottomLeftRadius: mine ? 22 : 6,
        borderBottomRightRadius: mine ? 6 : 22,
        backgroundColor: mine ? color.bgOverlay : color.bgRaised,
      }}
    >
      {state.items.length ? <Mosaic items={state.items} blur={blur} /> : null}
      <View style={{ paddingHorizontal: 6, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon.Lock size={13} c={color.friends} />
          <Text numberOfLines={1} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary, flexShrink: 1 }}>
            {mine ? mx.youShared(state.name) : state.name}
          </Text>
        </View>
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>
          {n} · {when}
        </Text>
      </View>
      {mine ? (
        <Pressable
          testID="album-card-stop"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            Albums.revoke(p.album, conv.id).finally(() => setBusy(false));
          }}
          style={{ height: 38, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgSecondary }}>{busy ? mx.stopping : mx.stop}</Text>
        </Pressable>
      ) : (
        <View style={{ height: 38, borderRadius: radius.pill, backgroundColor: color.friends, alignItems: 'center', justifyContent: 'center', marginBottom: space.xxs }}>
          <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{mx.open}</Text>
        </View>
      )}
    </Pressable>
  );
}

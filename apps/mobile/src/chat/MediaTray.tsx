// F-08 R-08.11–R-08.15 media tray (S-41, #135, mockup option A): opens in the keyboard slot under the
// composer. Photos tab = Sent recently (on this phone only) + camera roll + camera; Albums tab = share
// a private album in this chat. No modal: the chat stays readable above.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, LayoutChangeEvent, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { mmss, mx, timeLeft } from '../i18n/media';
import { prefs } from '../me/prefs';
import { color, font, radius, space, tileFor, type } from '../theme/tokens';
import { Button, Field, Icon, Segmented, Sheet } from '../ui';
import * as Albums from './albums';
import * as E from './engine';
import * as Lib from './library';
import { decryptToUri, loadOpts, pickPhotos, saveOpts, SendOpts, Source, takePhoto, videoProblem } from './media';
import { holdTray, MAX_PICK, Pick, toggle } from './pick';
import * as Recent from './recent';
import { isVideo } from './video';
import { VideoMark } from './VideoPlayer';

const EXPIRIES: SendOpts['expiry'][] = ['keep', '1h', '24h', '7d'];
const DUR_S = { '1h': 3600, '24h': 86400, '7d': 604800, keep: null } as const;
type Dur = keyof typeof DUR_S;

function Badge({ n }: { n: number }) {
  const on = n > 0;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 5,
        right: 5,
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: on ? color.hookup : 'rgba(255,255,255,0.85)',
        backgroundColor: on ? color.hookup : 'rgba(23,20,46,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <Text style={{ ...type.caption, color: color.onAccent }}>{n}</Text> : null}
    </View>
  );
}

function Tile({ uri, size, n, onPress, onLongPress, tag, label, testID, fill, video, dur }: { uri: string | null; size: number; n: number; onPress: () => void; onLongPress?: () => void; tag?: string; label: string; testID?: string; fill: string; video?: boolean; dur?: number }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityState={{ selected: n > 0 }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={{ width: size, height: size, borderRadius: size > 60 ? 10 : 12, overflow: 'hidden', backgroundColor: fill, borderWidth: n > 0 ? 3 : 0, borderColor: color.hookup }}
    >
      {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
      {video ? <VideoMark dur={dur} small /> : null}
      <Badge n={n} />
      {tag ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 4, bottom: 4, paddingHorizontal: 5, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.glass }}>
          <Text style={{ ...type.caption, fontSize: 9, lineHeight: 12, color: color.fgSoft }}>{tag}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function RecentTile({ r, n, here, onPress, onLongPress }: { r: Recent.Recent; n: number; here: boolean; onPress: () => void; onLongPress: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    Recent.uri(r).then(setUri, () => {});
  }, [r]);
  return <Tile testID={`recent-${r.id}`} uri={uri} size={64} n={n} onPress={onPress} onLongPress={onLongPress} tag={here ? mx.sentHere : undefined} label={mx.recent} fill={tileFor(r.id)} />;
}

function Label({ text, right, onRight, rightIcon }: { text: string; right?: string; onRight?: () => void; rightIcon?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.xs }}>
      <Text style={{ ...type.caption, letterSpacing: 0.8, color: color.fgMuted, textTransform: 'uppercase' }}>{text}</Text>
      {right ? (
        <Pressable accessibilityRole={onRight ? 'button' : 'text'} onPress={onRight} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {rightIcon ? <Icon.Lock size={11} /> : null}
          <Text style={{ ...type.meta, fontSize: 12, fontFamily: font.bold, color: color.trust }}>{right}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Chip({ label, on, onPress, testID, locked, a11y }: { label: string; on: boolean; onPress: () => void; testID: string; locked?: boolean; a11y?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ selected: on, disabled: locked }}
      onPress={locked ? undefined : onPress}
      style={{ height: 36, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: on ? color.trust : color.bgOverlay, alignItems: 'center', justifyContent: 'center', opacity: locked ? 0.85 : 1 }}
    >
      <Text numberOfLines={1} style={{ ...type.meta, fontFamily: font.heavy, color: on ? color.onAccent : color.fgPrimary }}>
        {label}
      </Text>
    </Pressable>
  );
}

function AlbumTile({ a, cid, w, onPress }: { a: Albums.Album; cid: string; w: number; onPress: () => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // Cover = first photo: videos are not downloaded just to show a cover (#138).
  const cover = a.items.find((i) => !isVideo(i));
  useEffect(() => {
    if (cover) decryptToUri(cover).then(setUri, () => {});
  }, [cover]);
  const share = a.shares.find((s) => s.cid === cid && (!s.until || s.until > now));
  return (
    <Pressable testID={`tray-album-${a.name}`} accessibilityRole="button" accessibilityLabel={a.name} onPress={onPress} style={({ pressed }) => ({ width: w, height: 118, borderRadius: 16, overflow: 'hidden', backgroundColor: tileFor(a.id), opacity: pressed ? 0.85 : 1 })}>
      {uri ? <Image source={{ uri }} style={{ position: 'absolute', width: w, height: 118 }} resizeMode="cover" /> : null}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 74, backgroundColor: color.glass }} />
      <View style={{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: share ? color.trust : color.friends }}>
        <Icon.Lock size={10} c={color.onAccent} />
        <Text style={{ ...type.caption, fontSize: 9.5, lineHeight: 12, color: color.onAccent }}>{share ? (share.until ? mx.sharedLeft(timeLeft(share.until)) : mx.sharedOn) : mx.private}</Text>
      </View>
      <View style={{ position: 'absolute', left: 10, right: 10, bottom: 9 }}>
        <Text numberOfLines={1} style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>
          {a.name}
        </Text>
        <Text numberOfLines={1} style={{ ...type.meta, fontSize: 11, lineHeight: 15, color: color.fgSecondary }}>
          {counts(a.items)}
        </Text>
      </View>
    </Pressable>
  );
}

export function MediaTray({
  conv,
  height,
  bottom,
  onSend,
  onAlbumError,
  onEditAlbum,
}: {
  conv: E.Conv;
  height: number;
  bottom: number;
  onSend: (items: Source[], opts: SendOpts) => void;
  onAlbumError: (msg?: string) => void;
  onEditAlbum: (id: string) => void;
}) {
  const { me } = useSession();
  const group = !!conv.ctx;
  const [tab, setTab] = useState<'photos' | 'albums'>('photos');
  const [opts, setOpts] = useState<SendOpts>({ once: false, expiry: 'keep', save: false });
  const [sel, setSel] = useState<Pick[]>([]);
  const [recent, setRecent] = useState<Recent.Recent[]>([]);
  const [access, setAccess] = useState<Lib.Access | null>(Lib.available ? null : 'none');
  const [shots, setShots] = useState<Lib.Shot[]>([]);
  const [next, setNext] = useState<string | undefined>(undefined);
  const [albums, setAlbums] = useState<Albums.Album[]>([]);
  const [width, setWidth] = useState(0);
  const [rm, setRm] = useState<Recent.Recent | null>(null);
  const [share, setShare] = useState<Albums.Album | null>(null);
  const [naming, setNaming] = useState(false);
  const onceLocked = prefs().autoDelete || !!me.safe_mode_active;

  useEffect(() => {
    loadOpts().then(setOpts);
    const load = () => Recent.list().then(setRecent);
    load();
    return Recent.onRecent(load);
  }, []);
  useEffect(() => {
    const load = () => Albums.listAlbums().then((l) => setAlbums(l));
    load();
    return Albums.onAlbums(load);
  }, []);

  const loadRoll = useCallback(async (reset: boolean, after?: string) => {
    try {
      const p = await Lib.page(reset ? undefined : after);
      setShots((cur) => (reset ? p.items : [...cur, ...p.items]));
      setNext(p.next);
    } catch {
      setShots([]);
    }
  }, []);
  useEffect(() => {
    if (!Lib.available) return;
    Lib.current().then((a) => {
      setAccess(a);
      if (a === 'all' || a === 'limited') loadRoll(true);
    });
    return Lib.onChange(() => loadRoll(true));
  }, [loadRoll]);

  const setO = (o: SendOpts) => {
    setOpts(o);
    saveOpts(o).catch(() => {});
  };
  const eff: SendOpts = onceLocked ? { ...opts, once: true } : opts;
  const pos = (key: string) => sel.findIndex((s) => s.key === key) + 1;
  const pick = (p: Pick) => setSel((cur) => toggle(cur, p));
  const send = (items: Source[]) => {
    if (!items.length) return;
    setSel([]);
    onSend(items, eff);
  };

  const cols = 4;
  const gap = 3;
  const cell = width ? Math.floor((width - gap * (cols - 1)) / cols) : 0;
  const rollData = useMemo(() => [{ id: '__camera', uri: '', w: 0, h: 0 }, ...shots], [shots]);
  const albumW = width ? Math.floor((width - space.s) / 2) : 0;

  const header = (
    <View style={{ gap: space.s, paddingBottom: space.s }}>
      {recent.length ? (
        <>
          <Label text={mx.recent} right={mx.onlyHere} rightIcon />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {recent.map((r) => (
              <RecentTile key={r.id} r={r} n={pos('r:' + r.id)} here={r.to.includes(conv.id)} onPress={() => pick({ key: 'r:' + r.id, src: { kind: 'recent', r } })} onLongPress={() => setRm(r)} />
            ))}
          </ScrollView>
        </>
      ) : null}
      {Lib.available ? (
        <Label text={mx.roll} right={access === 'limited' || access === 'all' ? mx.manage : undefined} onRight={() => access && Lib.manage(access)} />
      ) : null}
      {access === 'undetermined' || access === 'none' || !Lib.available ? (
        <View style={{ padding: space.m, gap: space.s, borderRadius: 16, backgroundColor: color.bgOverlay }}>
          {Lib.available ? (
            <>
              <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{mx.rollTitle}</Text>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{access === 'none' ? mx.rollDenied : mx.rollBody}</Text>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
            {Lib.available ? (
              <Pressable
                testID="roll-allow"
                accessibilityRole="button"
                onPress={async () => {
                  if (access === 'none') return Lib.manage('none');
                  const a = await Lib.ask();
                  setAccess(a);
                  if (a === 'all' || a === 'limited') loadRoll(true);
                }}
                style={{ height: 38, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: color.trust, justifyContent: 'center' }}
              >
                <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{access === 'none' ? mx.settings : mx.allow}</Text>
              </Pressable>
            ) : null}
            <Pressable testID="roll-library" accessibilityRole="button" onPress={() => pickPhotos(MAX_PICK).then(send, () => {})} style={{ height: 38, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: color.bgRaised, justifyContent: 'center', borderWidth: 1.5, borderColor: color.line }}>
              <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgPrimary }}>{mx.library}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  const showGrid = access === 'all' || access === 'limited';

  return (
    <View testID="media-tray" accessibilityLabel={mx.tray} style={{ height: height + bottom, backgroundColor: color.bgRaised, borderTopLeftRadius: radius.tray, borderTopRightRadius: radius.tray, paddingTop: space.s, paddingHorizontal: space.m, paddingBottom: bottom + space.s, gap: space.s }}>
      <Segmented
        label={mx.tray}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'photos', label: mx.photos },
          { value: 'albums', label: mx.albums },
        ]}
      />
      <View style={{ flex: 1, minHeight: 0 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {tab === 'photos' ? (
          showGrid && cell ? (
            <FlatList showsVerticalScrollIndicator={false}
              testID="roll-grid"
              data={rollData}
              keyExtractor={(s) => s.id}
              numColumns={cols}
              ListHeaderComponent={header}
              columnWrapperStyle={{ gap }}
              contentContainerStyle={{ gap }}
              onEndReachedThreshold={0.6}
              onEndReached={() => next && loadRoll(false, next)}
              renderItem={({ item }) =>
                item.id === '__camera' ? (
                  <Pressable testID="tray-camera" accessibilityRole="button" accessibilityLabel={mx.camera} onPress={() => takePhoto().then((s) => s && send([s]), () => {})} style={{ width: cell, height: cell, borderRadius: 10, backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}>
                    <Camera />
                  </Pressable>
                ) : (
                  <Tile testID={`roll-${item.id}`} uri={item.uri} size={cell} n={pos('l:' + item.id)} label={item.video ? `${mx.video} ${mmss(item.dur)}` : mx.roll} video={item.video} dur={item.dur} fill={color.bgOverlay} onPress={() => pick({ key: 'l:' + item.id, src: { kind: 'roll', shot: item } })} />
                )
              }
            />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {header}
              {Platform.OS !== 'web' ? (
                <Pressable testID="tray-camera" accessibilityRole="button" accessibilityLabel={mx.camera} onPress={() => takePhoto().then((s) => s && send([s]), () => {})} style={{ width: cell || 72, height: cell || 72, borderRadius: 10, backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}>
                  <Camera />
                </Pressable>
              ) : null}
            </ScrollView>
          )
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingBottom: space.s }}>
            {!albums.length ? <Text style={{ ...type.meta, color: color.fgSecondary, width: '100%', paddingVertical: space.xs }}>{mx.noAlbums}</Text> : null}
            {albumW
              ? albums.map((a) => <AlbumTile key={a.id} a={a} cid={conv.id} w={albumW} onPress={() => setShare(a)} />)
              : null}
            <Pressable testID="tray-album-new" accessibilityRole="button" onPress={() => setNaming(true)} style={{ width: albumW || 150, height: 118, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.line, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color.friends, alignItems: 'center', justifyContent: 'center' }}>
                <Icon.Plus c={color.onAccent} size={18} />
              </View>
              <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgSecondary }}>{mx.newAlbum}</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
      {tab === 'photos' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Chip testID="opt-expiry" label={`⏱ ${mx.expiry(opts.expiry)}`} a11y={`${mx.expiryLabel}: ${mx.expiry(opts.expiry)}`} on={opts.expiry !== 'keep'} onPress={() => setO({ ...opts, expiry: EXPIRIES[(EXPIRIES.indexOf(opts.expiry) + 1) % EXPIRIES.length] })} />
          <Chip testID="opt-once" label={`👁 ${mx.once}`} a11y={onceLocked ? mx.onceLocked : tx.chat.viewOnce} on={eff.once} locked={onceLocked} onPress={() => setO({ ...opts, once: !opts.once })} />
          <Chip testID="opt-save" label={`⤓ ${mx.save}`} a11y={tx.chat.allowSave} on={opts.save} onPress={() => setO({ ...opts, save: !opts.save })} />
          <Pressable
            testID="tray-send"
            accessibilityRole="button"
            accessibilityState={{ disabled: !sel.length }}
            onPress={() => send(sel.map((s) => s.src))}
            disabled={!sel.length}
            style={{ marginLeft: 'auto', height: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center', opacity: sel.length ? 1 : 0.35 }}
          >
            <Text style={{ ...type.headline, fontSize: 14, color: color.onAccent }}>{mx.send(sel.length)}</Text>
          </Pressable>
        </View>
      ) : null}

      <Sheet visible={!!rm} onClose={() => setRm(null)} title={mx.recent} closeLabel={tx.common.close}>
        <Button
          kind="secondary"
          title={mx.removeRecent}
          testID="recent-remove"
          onPress={() => {
            const r = rm!;
            setRm(null);
            setSel((cur) => cur.filter((s) => s.key !== 'r:' + r.id));
            Recent.remove(r.id);
          }}
        />
      </Sheet>

      <NewAlbumSheet
        visible={naming}
        onClose={() => setNaming(false)}
        onCreated={async (a) => {
          setNaming(false);
          const skipped = await Albums.addItems(a.id).catch(() => {
            onAlbumError();
            return undefined;
          });
          if (skipped) onAlbumError(videoProblem(skipped));
          const fresh = (await Albums.listAlbums()).find((x) => x.id === a.id);
          if (fresh) setShare(fresh);
        }}
      />

      <ShareSheet key={share?.id ?? 'none'} album={share} conv={conv} group={group} onClose={() => setShare(null)} onError={onAlbumError} onEdit={onEditAlbum} />
    </View>
  );
}

/** "3 photos · 1 video" (#138). */
export const counts = (items: { mime: string }[]) => {
  const v = items.filter(isVideo).length;
  return mx.countsPV(items.length - v, v);
};

function Camera() {
  return <Text style={{ fontSize: 24 }}>📷</Text>;
}

function NewAlbumSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (a: Albums.Album) => void }) {
  const [name, setName] = useState('');
  // #222: keep the tray (and this sheet) open while the name keyboard is up.
  useEffect(() => {
    if (!visible) return;
    holdTray(true);
    return () => holdTray(false);
  }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={mx.newAlbum} closeLabel={tx.common.close}>
      <Field label={mx.newName} value={name} onChangeText={setName} maxLength={40} autoFocus testID="tray-album-name" />
      <Button
        title={mx.create}
        disabled={!name.trim()}
        testID="tray-album-create"
        onPress={() =>
          Albums.createAlbum(name).then((a) => {
            setName('');
            onCreated(a);
          })
        }
      />
    </Sheet>
  );
}

const clock = (at: number) => new Date(at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/** R-08.15 share sheet: duration, Share album / Change time / Stop sharing. */
export function ShareSheet({ album, conv, group, onClose, onError, onEdit }: { album: Albums.Album | null; conv: E.Conv; group: boolean; onClose: () => void; onError: () => void; onEdit: (id: string) => void }) {
  const [dur, setDur] = useState<Dur>('24h');
  const [busy, setBusy] = useState<'share' | 'stop' | null>(null);
  const [now] = useState(() => Date.now());
  if (!album) return <Sheet visible={false} onClose={onClose} title="" closeLabel={tx.common.close}>{null}</Sheet>;
  const live = album.shares.find((s) => s.cid === conv.id && (!s.until || s.until > now));
  const run = async (k: 'share' | 'stop', fn: () => Promise<unknown>) => {
    setBusy(k);
    try {
      await fn();
      onClose();
    } catch {
      onError();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet visible onClose={onClose} title={group ? mx.shareGroup(album.name) : mx.shareTitle(album.name, conv.name)} closeLabel={tx.common.close}>
      <ShareCover album={album} />
      {!album.items.length ? (
        <>
          <Text style={{ ...type.body, color: color.fgSecondary }}>{mx.addFirstBody}</Text>
          <Button
            title={mx.addPhotos}
            testID="share-add"
            onPress={() => {
              onClose();
              onEdit(album.id);
            }}
          />
        </>
      ) : (
        <>
          {live ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon.Lock size={13} />
              <Text testID="share-live" style={{ ...type.meta, color: color.trust }}>
                {live.until ? mx.sharedUntil(clock(live.until)) : mx.sharedOpen}
              </Text>
            </View>
          ) : null}
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.caption, letterSpacing: 0.8, color: color.fgMuted, textTransform: 'uppercase' }}>{mx.howLong}</Text>
            <Segmented label={mx.howLong} value={dur} onChange={setDur} grow options={(['1h', '24h', '7d', 'keep'] as Dur[]).map((v) => ({ value: v, label: mx.durations[v] }))} />
          </View>
          <Pressable
            testID="share-go"
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => run('share', () => Albums.grant(album.id, conv.id, DUR_S[dur]))}
            style={{ height: 52, borderRadius: radius.pill, backgroundColor: color.friends, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
          >
            <Text style={{ ...type.headline, color: color.onAccent }}>{busy === 'share' ? '…' : live ? mx.change : mx.share}</Text>
          </Pressable>
          {live ? (
            <Pressable testID="share-stop" accessibilityRole="button" disabled={!!busy} onPress={() => run('stop', () => Albums.revoke(album.id, conv.id))} style={{ height: 48, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.danger, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ ...type.headline, fontSize: 15, color: color.danger }}>{busy === 'stop' ? mx.stopping : mx.stop}</Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Icon.Lock size={12} />
            <Text style={{ ...type.meta, fontSize: 12, color: color.trust, flex: 1 }}>{mx.shareNote}</Text>
          </View>
        </>
      )}
    </Sheet>
  );
}

function ShareCover({ album }: { album: Albums.Album }) {
  const [uris, setUris] = useState<(string | null)[]>([]);
  useEffect(() => {
    Promise.all(album.items.slice(0, 4).map((i) => (isVideo(i) ? null : decryptToUri(i).catch(() => null)))).then(setUris);
  }, [album]);
  return (
    <View style={{ flexDirection: 'row', gap: 4, height: 84 }}>
      {(album.items.length ? album.items.slice(0, 4) : [null]).map((it, i) => (
        <View key={it?.blob ?? i} style={{ flex: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: tileFor(it?.blob ?? album.id) }}>
          {uris[i] ? <Image source={{ uri: uris[i]! }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
          {it && isVideo(it) ? <VideoMark dur={it.dur} small /> : null}
        </View>
      ))}
      <View style={{ position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: radius.pill, backgroundColor: color.friends }}>
        <Icon.Lock size={10} c={color.onAccent} />
        <Text style={{ ...type.caption, fontSize: 9.5, lineHeight: 12, color: color.onAccent }}>{counts(album.items)}</Text>
      </View>
    </View>
  );
}

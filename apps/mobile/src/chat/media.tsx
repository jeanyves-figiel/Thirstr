// F-08 chat media: AES-256-GCM on device, ciphertext blob via /media, key inside the MLS message (R-08.2).
import { gcm } from '@noble/ciphers/aes.js';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { api } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { mmss, mx } from '../i18n/media';
import { color, radius, space, type } from '../theme/tokens';
import { fromB64, rand, toB64 } from './bytes';
import * as E from './engine';
import { prefs } from '../me/prefs';
import { kv } from './kv';
import * as Recent from './recent';
import * as Lib from './library';
import * as MediaCache from './mediaCache';
import { PhotoViewer } from '../ui/PhotoViewer';
import * as Video from './video';
import { SMALL_PHOTO, saving, useDataSaver } from '../app/dataSaver';
import { VideoMark, VideoPlayer } from './VideoPlayer';

export type SendOpts = { once: boolean; expiry: '1h' | '24h' | '7d' | 'keep'; save: boolean };
const EXPIRY_S = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, keep: null } as const;

export async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  const { File } = await import('expo-file-system');
  return new File(uri).bytes();
}

/** Encrypts and uploads bytes; returns the blob reference (key never leaves the device unencrypted). */
export async function uploadEncrypted(bytes: Uint8Array, opts: { album?: boolean; ttl_s?: number; once?: boolean } = {}) {
  const key = rand(32);
  const iv = rand(12);
  const ct = gcm(key, iv).encrypt(bytes);
  // #271 scoped: only the uploader and the accounts it was sent to may fetch it.
  const r = await api<{ blob_id: string; put_url: string }>('POST', '/media/upload', { size: ct.length, scoped: true, ...opts });
  const put = await fetch(r.put_url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: ct as unknown as BodyInit });
  if (!put.ok) throw new Error('upload failed');
  return { blob: r.blob_id, key: toB64(key), iv: toB64(iv) };
}

// Decrypted data URIs in memory, LRU-bounded (SR-05): the disk cache holds ciphertext only.
const cache = new Map<string, string>();
const MEM_MAX = 40;
const remember = (blob: string, uri: string) => {
  cache.delete(blob);
  cache.set(blob, uri);
  while (cache.size > MEM_MAX) cache.delete(cache.keys().next().value as string);
};

/** Decrypts a blob into a data URI: memory → on-device ciphertext (SR-05) → download. */
export async function decryptToUri(ref: { blob: string; key: string; iv: string; mime: string; once?: boolean; exp?: number }): Promise<string> {
  const hit = cache.get(ref.blob);
  if (hit) {
    remember(ref.blob, hit);
    return hit;
  }
  let ct = await MediaCache.get(ref.blob).catch(() => null);
  if (!ct) {
    const { url } = await api<{ url: string }>('GET', `/media/${ref.blob}`);
    ct = new Uint8Array(await (await fetch(url)).arrayBuffer());
    await MediaCache.put(ref.blob, ct, { once: ref.once, exp: ref.exp }).catch(() => {});
  }
  const plain = gcm(fromB64(ref.key), fromB64(ref.iv)).decrypt(ct);
  const uri = `data:${ref.mime};base64,${toB64(plain)}`;
  if (!ref.once) remember(ref.blob, uri);
  return uri;
}

export type Source =
  | { kind: 'recent'; r: Recent.Recent }
  | { kind: 'uri'; uri: string; w?: number; h?: number }
  | { kind: 'roll'; shot: Lib.Shot }
  /** #138: a video from the picker or the camera (already exported by the system); `dur` in s. */
  | { kind: 'video'; uri: string; w?: number; h?: number; dur?: number };

/** Re-encodes a photo on the phone: JPEG 0.85, max 2560 px, no EXIF/GPS (R-08.1, R-08.13). */
export async function reencode(uri: string, w?: number, h?: number) {
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const ctx = ImageManipulator.manipulate(uri);
  const long = Math.max(w ?? 0, h ?? 0);
  if (long > 2560) ctx.resize((w ?? 0) >= (h ?? 0) ? { width: 2560 } : { height: 2560 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { bytes: await readBytes(out.uri), w: out.width, h: out.height, mime: 'image/jpeg' };
}

/** R-08.17: a video file → checked, metadata removed (location, device, dates). */
async function videoFrom(src: Source) {
  if (src.kind === 'video') return { ...Video.prepare(await readBytes(src.uri), src.dur), w: src.w, h: src.h };
  if (src.kind === 'roll' && src.shot.video) {
    if (src.shot.dur && src.shot.dur > Video.MAX_S + 1) throw new Video.VideoError('long');
    return { ...Video.prepare(await readBytes(await Lib.fileUri(src.shot)), src.shot.dur), w: src.shot.w, h: src.shot.h };
  }
  return null;
}

async function sendVideo(conv: E.Conv, v: { bytes: Uint8Array; mime: string; dur?: number; w?: number; h?: number }, opts: SendOpts) {
  const exp = EXPIRY_S[opts.expiry];
  const ref = await uploadEncrypted(v.bytes, { ttl_s: exp ?? undefined });
  // Videos are not kept in Sent recently (R-08.14).
  await E.send(conv.id, {
    t: 'media',
    media: { ...ref, mime: v.mime, w: v.w, h: v.h, dur: v.dur, once: opts.once || undefined, exp: exp ? Date.now() + exp * 1000 : undefined, save: opts.save || undefined },
  });
}

async function sendOne(conv: E.Conv, src: Source, opts: SendOpts) {
  const v = await videoFrom(src);
  if (v) return sendVideo(conv, v, opts);
  if (src.kind === 'video') return;
  let photo: { bytes: Uint8Array; w?: number; h?: number; mime: string };
  if (src.kind === 'recent') {
    const b = await Recent.bytes(src.r);
    if (!b) throw new Error('gone');
    photo = { bytes: b, w: src.r.w, h: src.r.h, mime: src.r.mime };
  } else if (src.kind === 'roll') {
    photo = await reencode(await Lib.fileUri(src.shot), src.shot.w, src.shot.h);
  } else {
    photo = await reencode(src.uri, src.w, src.h);
  }
  if (photo.bytes.length > 20 * 1024 * 1024) throw new Error('too large');
  const exp = EXPIRY_S[opts.expiry];
  // Always a new key and a new blob, also when sending a Sent recently photo again (R-08.14).
  const ref = await uploadEncrypted(photo.bytes, { ttl_s: exp ?? undefined });
  await E.send(conv.id, {
    t: 'media',
    media: { ...ref, mime: photo.mime, w: photo.w, h: photo.h, size: photo.bytes.length + 16, once: opts.once || undefined, exp: exp ? Date.now() + exp * 1000 : undefined, save: opts.save || undefined },
  });
  if (src.kind === 'recent') await Recent.touch(src.r.id, conv.id).catch(() => {});
  else await Recent.keep(photo.bytes, { mime: photo.mime, w: photo.w, h: photo.h }, conv.id).catch(() => {});
}

/** R-08.13: each item becomes its own media message, in order. `video` = why a video was refused. */
export async function sendPhotos(conv: E.Conv, items: Source[], opts: SendOpts) {
  let failed = 0;
  let video: Video.VideoError['kind'] | undefined;
  for (const it of items) {
    try {
      await sendOne(conv, it, opts);
    } catch (e) {
      failed++;
      if (e instanceof Video.VideoError) video = e.kind;
    }
  }
  return { failed, video };
}

/** Message for a refused video (#138). */
export function videoProblem(kind: Video.VideoError['kind']) {
  return kind === 'large' ? mx.tooLarge : kind === 'long' ? mx.tooLong : mx.videoError;
}

// iOS: the system exports picked and recorded videos at 1080p H.265 (R-08.17). Android keeps the file;
// the 50 MB cap still applies.
// R-17.16: with Data saver on, the export is 720p (the system's 720p preset is H.264).
const VIDEO_PICK = () => ({
  videoMaxDuration: Video.MAX_S,
  videoExportPreset: saving() ? ImagePicker.VideoExportPreset.H264_1280x720 : ImagePicker.VideoExportPreset.HEVC_1920x1080,
});
const asSource = (a: ImagePicker.ImagePickerAsset): Source =>
  a.type === 'video' ? { kind: 'video', uri: a.uri, w: a.width, h: a.height, dur: a.duration ? a.duration / 1000 : undefined } : { kind: 'uri', uri: a.uri, w: a.width, h: a.height };

/** System picker (no library access needed), up to `limit` photos and videos (#138). */
export async function pickPhotos(limit = 10): Promise<Source[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 1, exif: false, allowsMultipleSelection: true, selectionLimit: limit, orderedSelection: true, ...VIDEO_PICK() });
  if (r.canceled) return [];
  return r.assets.map(asSource);
}

/**
 * System camera: one photo, or a video up to 3 min (#231). Recording asks for the microphone the
 * first time (iOS). The file then goes through the same checks and metadata removal as any video (R-08.17).
 */
export async function takePhoto(): Promise<Source | null> {
  const p = await ImagePicker.requestCameraPermissionsAsync();
  if (!p.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 1, exif: false, videoQuality: ImagePicker.UIImagePickerControllerQualityType.High, ...VIDEO_PICK() });
  if (r.canceled || !r.assets[0]) return null;
  return asSource(r.assets[0]);
}

const OPTS_K = 'media.opts';
export const DEFAULT_OPTS: SendOpts = { once: false, expiry: 'keep', save: false };
export const loadOpts = async () => ({ ...DEFAULT_OPTS, ...((await kv.get<SendOpts>(OPTS_K)) ?? {}) });
export const saveOpts = (o: SendOpts) => kv.set(OPTS_K, o);

// R-07.10 / R-08.7: media from someone you haven't replied to follows Settings › explicit_from_strangers.
// Until the on-device classifier ships, all such media is treated as possibly explicit.
export function strangerPolicy(conv: E.Conv, setting: string | undefined): 'show' | 'blur' | 'block' {
  if (conv.iWrote) return 'show';
  return setting === 'allow' ? 'show' : setting === 'block' ? 'block' : 'blur';
}

export function MediaBubble({ m, media, mine, cid, conv }: { m: E.Msg; media: E.MediaRef; mine: boolean; cid: string; conv: E.Conv }) {
  const { me } = useSession();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [full, setFull] = useState(false);
  const fg = mine ? color.onAccent : color.fgPrimary;
  const [now] = useState(() => Date.now());
  const expired = !!media.exp && media.exp < now;
  const policy = mine ? 'show' : strangerPolicy(conv, me.settings?.explicit_from_strangers);
  // View-once, or auto-delete after viewing (Settings, always in Safe Mode: F-14).
  const once = (!!media.once || prefs().autoDelete || !!me.safe_mode_active) && !mine;
  const gone = expired || (once && m.opened);
  // R-17.16: with Data saver on, only small photos load by themselves; the rest wait for a tap.
  const { saving } = useDataSaver();
  const [asked, setAsked] = useState(false);
  const small = media.size != null && media.size <= SMALL_PHOTO;
  const held = saving && !small && !asked && !mine;
  const autoload = !gone && !once && policy !== 'block' && !held;

  const video = Video.isVideo(media);
  useEffect(() => {
    if (!autoload || video) return;
    decryptToUri(media).then(setUri, () => setFailed(true));
  }, [autoload, media, video]);

  if (policy === 'block') return <Text style={{ ...type.meta, color: fg }}>{tx.chat.mediaBlocked}</Text>;
  if (gone) return <Text style={{ ...type.meta, color: fg }}>{video ? '🎬' : '📷'} {expired ? tx.chat.mediaExpired : tx.chat.viewedOnce}</Text>;
  if (failed) return <Text style={{ ...type.meta, color: fg }}>📷 {tx.common.error}</Text>;

  const w = 220;
  const h = media.w && media.h ? Math.min(320, Math.round((w * media.h) / media.w)) : 220;

  if (video) {
    // R-08.17: dark tile with ▶ and length; nothing is downloaded until it is played.
    return (
      <>
        <Pressable
          testID="video-bubble"
          accessibilityRole="button"
          accessibilityLabel={`${once ? tx.chat.viewOnce : mx.play}${media.dur != null ? ', ' + mmss(media.dur) : ''}`}
          onPress={() => setFull(true)}
          style={{ width: w, height: once ? 120 : h, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.bgOverlay }}
        >
          <VideoMark dur={media.dur} />
          {once ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 8 }}>
              <Text style={{ ...type.meta, color: color.fgPrimary }}>👁 {tx.chat.viewOnce}</Text>
            </View>
          ) : null}
        </Pressable>
        <VideoPlayer
          item={full ? media : null}
          onClose={() => {
            setFull(false);
            if (once) E.markOpened(cid, m.id);
          }}
        />
      </>
    );
  }

  if (once) {
    return (
      <>
        <Pressable
          accessibilityRole="button"
          onPress={() => decryptToUri(media).then((u) => { setUri(u); setFull(true); }, () => setFailed(true))}
          style={{ paddingVertical: space.xs }}
        >
          <Text style={{ ...type.headline, color: fg }}>👁 {tx.chat.viewOnce}</Text>
        </Pressable>
        <Viewer
          uri={full ? uri : null}
          onClose={() => {
            setFull(false);
            setUri(null);
            E.markOpened(cid, m.id);
          }}
        />
      </>
    );
  }

  if (held && !uri) {
    const mb = media.size != null ? `${(media.size / 1048576).toFixed(1)} MB` : null;
    return (
      <Pressable
        testID="saver-photo"
        accessibilityRole="button"
        accessibilityLabel={`${mx.saverLoad}${mb ? ', ' + mb : ''}`}
        onPress={() => setAsked(true)}
        style={{ width: w, height: h, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center', gap: space.xs }}
      >
        <Text style={{ ...type.headline, color: color.fgPrimary }}>⬇ {mx.saverLoad}</Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{mb ? mx.saverPhoto(mb) : mx.saverOn}</Text>
      </Pressable>
    );
  }

  const blurred = policy === 'blur' && !reveal;
  return (
    <>
      <Pressable accessibilityRole="imagebutton" onPress={() => (blurred ? setReveal(true) : setFull(true))} style={{ width: w, height: h, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: color.bgOverlay }}>
        {uri ? <Image source={{ uri }} style={{ width: w, height: h }} blurRadius={blurred ? 40 : 0} resizeMode="cover" accessibilityLabel={tx.chat.photo} /> : null}
        {blurred ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{tx.chat.tapToView}</Text>
          </View>
        ) : null}
      </Pressable>
      <Viewer uri={full ? uri : null} onClose={() => setFull(false)} />
    </>
  );
}

/** S-43 media viewer (F-19 G13: pinch / double-tap zoom, swipe down to close). One photo, so no paging. */
function Viewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return <PhotoViewer items={uri ? [uri] : null} index={0} src={(u: string) => u} onClose={onClose} single />;
}

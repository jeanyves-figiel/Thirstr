// F-08 R-08.4 private albums. Items are encrypted on the device, one random key per item.
// Grant = send the item keys E2EE (album.grant). Revoke = album.revoke + rotate every item to a new
// key and blob, then delete the old blobs, so a revoked device has nothing left to fetch (AC-08.2).
import { gcm } from '@noble/ciphers/aes.js';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api/client';
import { fromB64, hex, rand } from './bytes';
import * as E from './engine';
import { kv } from './kv';
import * as People from './people';
import { readBytes, uploadEncrypted } from './media';
import * as Video from './video';

/** `via: 'friends'` = added by "Open to all friends" (#247 R-07.45), removed with the friendship. */
export type Share = { cid: string; until?: number; via?: 'friends' };
export type Album = { id: string; name: string; items: E.AlbumItem[]; shares: Share[]; friends?: boolean };

const emit = new Set<() => void>();
export const onAlbums = (fn: () => void) => {
  emit.add(fn);
  return () => {
    emit.delete(fn);
  };
};

export const listAlbums = async () => (await kv.get<Album[]>('albums')) ?? [];
async function saveAll(list: Album[]) {
  await kv.set('albums', list);
  emit.forEach((f) => f());
}
async function update(id: string, fn: (a: Album) => Album | null) {
  const list = await listAlbums();
  const next = list.map((a) => (a.id === id ? fn(a) : a)).filter(Boolean) as Album[];
  await saveAll(next);
  return next.find((a) => a.id === id) ?? null;
}

export async function createAlbum(name: string) {
  const a: Album = { id: hex(rand(8)), name: name.trim().slice(0, 40) || 'Album', items: [], shares: [] };
  await saveAll([...(await listAlbums()), a]);
  return a;
}

const live = (s: Share) => !s.until || s.until > Date.now();

async function regrant(a: Album) {
  for (const s of a.shares.filter(live)) {
    await E.send(s.cid, { t: 'album.grant', album: a.id, name: a.name, items: a.items, until: s.until }, { silent: true }).catch(() => {});
  }
}

/**
 * Adds photos and videos from the library (no count limit in private albums). Videos (#138): exported
 * at 1080p by the system, metadata removed on the phone, ≤ 50 MB / 3 min each (R-08.17).
 * Returns why a video was skipped, if one was; the other items are still added.
 */
export async function addItems(id: string): Promise<Video.VideoError['kind'] | undefined> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 0.85,
    exif: false,
    allowsMultipleSelection: true,
    selectionLimit: 20,
    videoMaxDuration: Video.MAX_S,
    videoExportPreset: ImagePicker.VideoExportPreset.HEVC_1920x1080,
  });
  if (r.canceled) return;
  const added: E.AlbumItem[] = [];
  let skipped: Video.VideoError['kind'] | undefined;
  for (const asset of r.assets) {
    if (asset.type === 'video') {
      try {
        const v = Video.prepare(await readBytes(asset.uri), asset.duration ? asset.duration / 1000 : undefined);
        added.push({ ...(await uploadEncrypted(v.bytes, { album: true })), mime: v.mime, dur: v.dur, w: asset.width, h: asset.height });
      } catch (e) {
        if (e instanceof Video.VideoError) skipped = e.kind;
        else throw e;
      }
      continue;
    }
    const ref = await uploadEncrypted(await readBytes(asset.uri), { album: true });
    added.push({ ...ref, mime: asset.mimeType ?? 'image/jpeg' });
  }
  const a = await update(id, (x) => ({ ...x, items: [...x.items, ...added] }));
  if (a) await regrant(a);
  return skipped;
}

export async function removeItem(id: string, blob: string) {
  await api('DELETE', `/media/${blob}`).catch(() => {});
  const a = await update(id, (x) => ({ ...x, items: x.items.filter((i) => i.blob !== blob) }));
  if (a) await regrant(a);
}

export async function grant(id: string, cid: string, untilS: number | null) {
  const until = untilS ? Date.now() + untilS * 1000 : undefined;
  const a = await update(id, (x) => ({ ...x, shares: [...x.shares.filter((s) => s.cid !== cid), { cid, until }] }));
  if (a) await E.send(cid, { t: 'album.grant', album: a.id, name: a.name, items: a.items, until });
}

async function rotate(a: Album): Promise<Album> {
  const items: E.AlbumItem[] = [];
  for (const it of a.items) {
    const { url } = await api<{ url: string }>('GET', `/media/${it.blob}`);
    const plain = gcm(fromB64(it.key), fromB64(it.iv)).decrypt(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    items.push({ ...it, ...(await uploadEncrypted(plain, { album: true })) });
    await api('DELETE', `/media/${it.blob}`).catch(() => {});
  }
  return { ...a, items };
}

export async function revoke(id: string, cid: string) {
  const cur = (await listAlbums()).find((a) => a.id === id);
  if (!cur) return;
  await E.send(cid, { t: 'album.revoke', album: id }).catch(() => {});
  const rotated = await rotate({ ...cur, shares: cur.shares.filter((s) => s.cid !== cid) });
  await update(id, () => rotated);
  await regrant(rotated);
}

export async function deleteAlbum(id: string) {
  const a = (await listAlbums()).find((x) => x.id === id);
  if (!a) return;
  for (const s of a.shares) await E.send(s.cid, { t: 'album.revoke', album: id }, { silent: true }).catch(() => {});
  for (const it of a.items) await api('DELETE', `/media/${it.blob}`).catch(() => {});
  await saveAll((await listAlbums()).filter((x) => x.id !== id));
}

/** A grant received in a conversation, if still valid. */
export async function receivedGrant(cid: string, album: string) {
  const g = await kv.get<Extract<E.Payload, { t: 'album.grant' }>>(`grant:${cid}:${album}`);
  if (!g || (g.until && g.until < Date.now())) return null;
  return g;
}

// ------------------------------------------------------------------ open to all friends (#247 R-07.45)

const friendCids = () =>
  People.friendList('yes')
    .map((p) => E.convWith(p)?.id)
    .filter((c): c is string => !!c);

async function grantFriend(id: string, cid: string) {
  const a = await update(id, (x) => (x.shares.some((s) => s.cid === cid) ? x : { ...x, shares: [...x.shares, { cid, via: 'friends' }] }));
  const s = a?.shares.find((x) => x.cid === cid);
  if (a && s?.via === 'friends') await E.send(cid, { t: 'album.grant', album: a.id, name: a.name, items: a.items }, { silent: true }).catch(() => {});
}

/** On: every accepted friend gets the album (and each new friend on accept). Off: friend shares are revoked; hand shares stay. */
export async function setFriendsOpen(id: string, on: boolean) {
  const a = await update(id, (x) => ({ ...x, friends: on }));
  if (!a) return;
  if (on) {
    for (const cid of friendCids()) await grantFriend(id, cid);
    return;
  }
  const mine = a.shares.filter((s) => s.via === 'friends');
  if (!mine.length) return;
  for (const s of mine) await E.send(s.cid, { t: 'album.revoke', album: id }, { silent: true }).catch(() => {});
  const rotated = await rotate({ ...a, shares: a.shares.filter((s) => s.via !== 'friends') });
  await update(id, () => rotated);
  await regrant(rotated);
}

E.onFriendChange((cid, _peer, now, was) => {
  void (async () => {
    for (const a of await listAlbums()) {
      if (now === 'yes' && a.friends && cid) await grantFriend(a.id, cid);
      else if (was === 'yes' && now !== 'yes' && a.shares.some((s) => s.cid === cid && s.via === 'friends')) await revoke(a.id, cid);
    }
  })().catch(() => {});
});

// R-01.11 Download my data (#25): one .zip packed on this phone, never stored on our servers.
//   data.json         server archive (GET /account/export) + device-only data (chats, notes, favorites,
//                     friends, trusted-contact names, album list)
//   photos/…          profile photos (fetched with the archive's 1 h URLs)
//   albums/<name>/…   private album photos and videos, decrypted here with the keys on this phone
// Streamed: one file in memory at a time, written to the zip as it goes (energy and RAM stay flat
// for big albums). Web builds the zip in memory and downloads it.
import { gcm } from '@noble/ciphers/aes.js';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { Platform, Share } from 'react-native';
import type { File, FileHandle } from 'expo-file-system';
import { api } from '../api/client';
import { listAlbums } from '../chat/albums';
import { fromB64 } from '../chat/bytes';
import * as E from '../chat/engine';
import { kv } from '../chat/kv';

export type ExportStage = 'account' | 'photos' | 'albums' | 'chats' | 'zip';
export type ExportProgress = { stage: ExportStage; done: number; total: number };

type ServerPhoto = { id: string; profile_id: string; slot: number; status: string; url: string | null };
type ServerExport = { data?: { photos?: ServerPhoto[] } } & Record<string, unknown>;

export class ExportCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

const ext = (mime: string) => (mime.includes('png') ? 'png' : mime.includes('heic') ? 'heic' : mime.startsWith('video/') ? (mime.includes('quicktime') ? 'mov' : 'mp4') : 'jpg');
const safe = (s: string) => s.replace(/[^\p{L}\p{N} _.-]/gu, '_').trim().slice(0, 40) || 'album';
const enc = (s: string) => new TextEncoder().encode(s);

async function bytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Exported for tests: builds every entry and hands it to `put` in order. */
export async function collect(put: (path: string, data: Uint8Array, compress: boolean) => Promise<void> | void, progress: (p: ExportProgress) => void, cancelled: () => boolean) {
  const check = () => {
    if (cancelled()) throw new ExportCancelled();
  };
  progress({ stage: 'account', done: 0, total: 1 });
  const server = await api<ServerExport>('GET', '/account/export');
  check();
  progress({ stage: 'account', done: 1, total: 1 });

  const photos = (server.data?.photos ?? []).filter((p) => p.url);
  const photoFiles: Record<string, string> = {};
  for (let i = 0; i < photos.length; i++) {
    check();
    progress({ stage: 'photos', done: i, total: photos.length });
    const p = photos[i];
    const path = `photos/${p.profile_id.slice(0, 8)}-${p.slot + 1}.jpg`;
    try {
      await put(path, await bytes(p.url!), false);
      photoFiles[p.id] = path;
    } catch {
      // a photo that can't be fetched stays listed in data.json without a file
    }
  }
  progress({ stage: 'photos', done: photos.length, total: photos.length });

  const albums = await listAlbums();
  const total = albums.reduce((n, a) => n + a.items.length, 0);
  let done = 0;
  const albumIndex = [];
  for (const a of albums) {
    const dir = `albums/${safe(a.name)}-${a.id.slice(0, 4)}`;
    const files: string[] = [];
    for (let i = 0; i < a.items.length; i++) {
      check();
      progress({ stage: 'albums', done, total });
      const it = a.items[i];
      try {
        const { url } = await api<{ url: string }>('GET', `/media/${it.blob}`);
        const plain = gcm(fromB64(it.key), fromB64(it.iv)).decrypt(await bytes(url));
        const path = `${dir}/${String(i + 1).padStart(3, '0')}.${ext(it.mime)}`;
        await put(path, plain, false);
        files.push(path);
      } catch {
        // missing blob: skipped
      }
      done++;
    }
    albumIndex.push({ name: a.name, items: files, shared_in_chats: a.shares.length });
  }
  progress({ stage: 'albums', done: total, total });

  check();
  const convs = E.getConvs();
  const chats = [];
  for (let i = 0; i < convs.length; i++) {
    progress({ stage: 'chats', done: i, total: convs.length });
    const c = convs[i];
    chats.push({
      name: c.name,
      peer_profile: c.ctx ? undefined : c.peer,
      group: c.ctx,
      messages: (await E.messages(c.id)).map((m) => {
        const p = m.p as { t: string; text?: string };
        return { from: m.from, at: new Date(m.at).toISOString(), type: p.t, text: p.text };
      }),
    });
  }
  progress({ stage: 'chats', done: convs.length, total: convs.length });
  const notes = await Promise.all((await kv.keys('note:')).map(async (k) => ({ profile: k.slice(5), note: await kv.get(k) })));
  const contacts = ((await kv.get<{ label: string; accepted?: boolean }[]>('safety:contacts')) ?? []).map((c) => ({ name: c.label, accepted: !!c.accepted }));
  const data = server.data ? { ...server.data, photos: (server.data.photos ?? []).map(({ url: _u, ...p }) => ({ ...p, file: photoFiles[p.id] ?? null })) } : undefined;
  const json = {
    ...server,
    note: 'Photos and album files are in this archive. Chats, private notes, favorites, friends and trusted-contact names come from this phone only.',
    data,
    device: { chats, private_notes: notes, favorites: (await kv.get('favs')) ?? {}, friends: (await kv.get('friends')) ?? {}, trusted_contacts: contacts, private_albums: albumIndex },
  };
  check();
  progress({ stage: 'zip', done: 0, total: 1 });
  await put('data.json', enc(JSON.stringify(json, null, 2)), true);
}

export async function exportData(progress: (p: ExportProgress) => void = () => {}, cancelled: () => boolean = () => false): Promise<void> {
  const name = `thirstr-export-${new Date().toISOString().slice(0, 10)}.zip`;
  const chunks: Uint8Array[] = [];
  let handle: FileHandle | null = null;
  let file: File | null = null;
  if (Platform.OS !== 'web') {
    const FS = await import('expo-file-system');
    file = new FS.File(FS.Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    handle = file.open(FS.FileMode.WriteOnly);
  }
  let fail: Error | null = null;
  let finished!: () => void;
  const ended = new Promise<void>((r) => (finished = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) fail = err;
    else if (handle) handle.writeBytesSync(chunk);
    else chunks.push(chunk);
    if (final || err) finished();
  });
  try {
    await collect(
      (path, data, compress) => {
        const f = compress ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
        zip.add(f);
        f.push(data, true);
        if (fail) throw fail;
      },
      progress,
      cancelled,
    );
    zip.end();
    await ended;
    if (fail) throw fail;
  } catch (e) {
    zip.terminate();
    handle?.close();
    if (file?.exists) file.delete();
    throw e;
  }
  handle?.close();
  progress({ stage: 'zip', done: 1, total: 1 });

  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/zip' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return;
  }
  await Share.share({ url: file!.uri, title: name });
}

// F-01 R-01.15 (#146) opt-in chat backup, sealed with a key only the recovery phrase unlocks.
// key = HKDF-SHA256(vault key, salt "thirstr-chats-v1"). Append-only segments (deflated JSON,
// AES-256-GCM, random IV, AAD "thirstr-chats-v1") hold new message rows + tombstones since the
// last run; a sealed manifest lists the segments with their SHA-256 (order + integrity).
// Compaction rewrites everything as fresh segments when > 200 segments or > 30 % tombstones.
// Never backed up: view-once media, chats whose disappearing timer is under 24 h, franking raw.
// #259 Photos and videos (opt-in, Wi-Fi only): each media file this phone holds is re-sealed in
// ≤ 4 MiB parts (raw AES-256-GCM, AAD "thirstr-chats-v1|media"), listed in a sealed media index
// segment the manifest points to; newest first within the 2 GiB quota, oldest left out.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { deflateSync, inflateSync } from 'fflate';
import { api, ApiError } from '../api/client';
import { unmetered } from '../app/dataSaver';
import { keepVaultKey, vaultKey } from '../auth/recovery';
import { concat, fromB64, fromUtf8, hex, rand, toB64, utf8 } from './bytes';
import * as E from './engine';
import { kv } from './kv';
import * as MediaCache from './mediaCache';

const AAD = utf8('thirstr-chats-v1');
const PLAIN_MAX = 4 * 1024 * 1024; // before deflate; the server takes ≤ 4.5 MiB ciphertext
const DAY = 86_400_000;
const STATE = 'backup.state';
const PREFS = 'backup.prefs';

export type Prefs = { on: boolean; cellular: boolean; media?: boolean };
type SegRef = { id: string; sha: string; size?: number };
type MediaEntry = { parts: SegRef[]; size: number; at: number; exp?: number };
/** `ids`: per chat, the message ids already in the backup (to find new rows and deletions). */
type State = { segs: SegRef[]; ids: Record<string, string[]>; tomb: number; rows: number; at: number; bytes: number; media?: Record<string, MediaEntry>; idx?: SegRef };
type Segment = { v: 1; convs: E.Conv[]; rows: Record<string, E.Msg[]>; tomb: Record<string, string[]> };
type Manifest = { v: 1; segs: SegRef[]; at: number; idx?: SegRef };
type MediaIndex = { v: 1; media: Record<string, MediaEntry> };

const MEDIA_AAD = utf8('thirstr-chats-v1|media');
const PART = 4 * 1024 * 1024; // raw bytes per media part (+ 28 B seal, server max 4.5 MiB)
/** Room kept for message segments and the index inside the 2 GiB quota. */
export const QUOTA = 2 * 1024 * 1024 * 1024;
const MEDIA_ROOM = 0.95;

const empty = (): State => ({ segs: [], ids: {}, tomb: 0, rows: 0, at: 0, bytes: 0 });

export const chatKey = (vault: Uint8Array) => hkdf(sha256, vault, utf8('thirstr-chats-v1'), utf8('chats'), 32);

export function sealBox(key: Uint8Array, data: unknown): Uint8Array {
  const iv = rand(12);
  return concat(iv, gcm(key, iv, AAD).encrypt(deflateSync(utf8(JSON.stringify(data)), { level: 6 })));
}

export function openBox<T>(key: Uint8Array, box: Uint8Array): T {
  return JSON.parse(fromUtf8(inflateSync(gcm(key, box.slice(0, 12), AAD).decrypt(box.slice(12))))) as T;
}

export const prefs = async (): Promise<Prefs> => ({ on: false, cellular: false, ...((await kv.get<Prefs>(PREFS)) ?? {}) });
export const lastRun = async () => (await kv.get<State>(STATE))?.at ?? 0;

/** What goes in: no view-once, no chats that disappear within a day, no franking plaintext. */
export function keep(c: E.Conv, m: E.Msg): E.Msg | null {
  const ttl = E.TTL_S[c.ttl];
  if (ttl && ttl < DAY / 1000 + 1) return null;
  if (m.p.t === 'media' && m.p.media.once) return null;
  if (m.status === 'sending' || m.status === 'failed') return null;
  const { raw: _raw, ...rest } = m;
  return rest;
}

/** Splits rows into segment-sized pieces (by JSON length, before deflate). */
export function pack(convs: E.Conv[], rows: Record<string, E.Msg[]>, tomb: Record<string, string[]>): Segment[] {
  const out: Segment[] = [];
  let cur: Segment = { v: 1, convs, rows: {}, tomb };
  let size = JSON.stringify(convs).length + JSON.stringify(tomb).length;
  for (const [cid, list] of Object.entries(rows)) {
    for (const m of list) {
      const n = JSON.stringify(m).length + 1;
      if (size + n > PLAIN_MAX && Object.keys(cur.rows).length) {
        out.push(cur);
        cur = { v: 1, convs: [], rows: {}, tomb: {} };
        size = 0;
      }
      (cur.rows[cid] ??= []).push(m);
      size += n;
    }
  }
  out.push(cur);
  return out;
}

export const sealMedia = (key: Uint8Array, b: Uint8Array) => {
  const iv = rand(12);
  return concat(iv, gcm(key, iv, MEDIA_AAD).encrypt(b));
};
export const openMedia = (key: Uint8Array, box: Uint8Array) => gcm(key, box.slice(0, 12), MEDIA_AAD).decrypt(box.slice(12));

async function upload(key: Uint8Array, seg: Segment | MediaIndex): Promise<SegRef & { size: number }> {
  return uploadBox(sealBox(key, seg));
}

async function uploadBox(box: Uint8Array): Promise<SegRef & { size: number }> {
  const sha = sha256(box);
  const r = await api<{ id: string; upload_url: string }>('POST', '/me/backup/segments', { size: box.length, sha256: toB64(sha) });
  const put = await fetch(r.upload_url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: box as unknown as BodyInit });
  if (!put.ok) throw new Error('upload failed');
  return { id: r.id, sha: hex(sha), size: box.length };
}

async function commit(key: Uint8Array, segs: SegRef[], media: Record<string, MediaEntry> = {}, idx?: SegRef) {
  const manifest: Manifest = { v: 1, segs: segs.map(({ id, sha }) => ({ id, sha })), at: Date.now(), ...(idx ? { idx } : {}) };
  const all = [...segs.map((s) => s.id), ...(idx ? [idx.id] : []), ...Object.values(media).flatMap((m) => m.parts.map((x) => x.id))];
  return api<{ bytes: number; updated_at: string }>('PUT', '/me/backup/manifest', { manifest: toB64(sealBox(key, manifest)), segments: all });
}

type Want = { blob: string; size: number; at: number; exp?: number };

/**
 * #259: which media files go in. Newest first while they fit `room` bytes; the rest (oldest)
 * stay out. Already-uploaded files keep their parts.
 */
export function pickMedia(want: Want[], room: number): Want[] {
  const out: Want[] = [];
  let used = 0;
  for (const w of [...want].sort((a, b) => b.at - a.at)) {
    const cost = w.size + Math.ceil(w.size / PART) * 28;
    if (used + cost > room) continue;
    used += cost;
    out.push(w);
  }
  return out;
}

/**
 * Uploads missing media parts; calls `checkpoint` with the new list every ~64 MiB and at the end
 * (only when something changed). Stops quietly at the quota or the daily segment limit.
 */
async function syncMedia(key: Uint8Array, have: Record<string, MediaEntry>, pick: Want[], checkpoint: (m: Record<string, MediaEntry>) => Promise<void>) {
  const media: Record<string, MediaEntry> = {};
  const keepIds = new Set(pick.map((w) => w.blob));
  let changed = Object.keys(have).some((b) => !keepIds.has(b));
  for (const w of pick) if (have[w.blob]) media[w.blob] = have[w.blob];
  let pending = 0;
  for (const w of pick) {
    if (media[w.blob]) continue;
    const ct = await MediaCache.get(w.blob).catch(() => null);
    if (!ct) continue;
    try {
      const parts: SegRef[] = [];
      for (let off = 0; off < ct.length; off += PART) parts.push(await uploadBox(sealMedia(key, ct.slice(off, off + PART))));
      media[w.blob] = { parts, size: ct.length, at: w.at, exp: w.exp };
      changed = true;
      pending += parts.length;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 422 || e.status === 429)) break; // quota / daily limit: next run
      throw e;
    }
    if (pending >= 16) {
      await checkpoint({ ...media });
      pending = 0;
      changed = false;
    }
  }
  if (changed || pending) await checkpoint(media);
}

/** Runs one backup: new rows + tombstones, or a full rewrite when due. */
export async function backupNow(opts: { full?: boolean } = {}): Promise<{ rows: number; bytes: number } | null> {
  const vault = await vaultKey();
  if (!vault) return null;
  const key = chatKey(vault);
  // Main's start-up effect runs before the engine has loaded the chat list; an empty list here
  // would tombstone every chat in the backup.
  await E.loadedConvs();
  const st = (await kv.get<State>(STATE)) ?? empty();
  const convs = E.getConvs().filter((c) => !c.gone);
  const full = opts.full || !st.segs.length || st.segs.length >= 200 || (st.rows > 0 && st.tomb / st.rows > 0.3);

  const p = await prefs();
  const withMedia = !!p.media && unmetered(); // #259: Wi-Fi only, whatever the mobile-data switch says
  const want: Want[] = [];
  const rows: Record<string, E.Msg[]> = {};
  const tomb: Record<string, string[]> = {};
  const ids: Record<string, string[]> = {};
  let total = 0;
  for (const c of convs) {
    const have = new Set(full ? [] : (st.ids[c.id] ?? []));
    const list = (await E.messages(c.id)).map((m) => keep(c, m)).filter((m): m is E.Msg => !!m);
    if (withMedia)
      for (const m of list) {
        if (m.p.t !== 'media') continue;
        const size = await MediaCache.sizeOf(m.p.media.blob);
        if (size) want.push({ blob: m.p.media.blob, size, at: m.at, exp: m.p.media.exp });
      }
    ids[c.id] = list.map((m) => m.id);
    total += list.length;
    const fresh = list.filter((m) => !have.has(m.id));
    if (fresh.length) rows[c.id] = fresh;
    if (!full) {
      const now = new Set(ids[c.id]);
      const gone = [...have].filter((id) => !now.has(id));
      if (gone.length) tomb[c.id] = gone;
    }
  }
  if (!full) for (const cid of Object.keys(st.ids)) if (!ids[cid] && st.ids[cid].length) tomb[cid] = st.ids[cid];

  const nTomb = Object.values(tomb).reduce((n, l) => n + l.length, 0);
  const nRows = Object.values(rows).reduce((n, l) => n + l.length, 0);

  // Messages first (small, the part that matters most), committed on their own.
  let segs = st.segs;
  let media = st.media ?? {};
  let idx = st.idx;
  let bytes = st.bytes;
  const save = async () => {
    const res = await commit(key, segs, media, idx);
    bytes = res.bytes;
    await kv.set(STATE, { segs, ids, tomb: full ? 0 : st.tomb + nTomb, rows: total, at: Date.now(), bytes, media, idx } satisfies State);
  };
  const dropMedia = !p.media && Object.keys(media).length > 0;
  if (full || nRows || nTomb || dropMedia) {
    const added: SegRef[] = [];
    if (full || nRows || nTomb)
      for (const seg of pack(convs, rows, tomb)) {
        const r = await upload(key, seg);
        added.push({ id: r.id, sha: r.sha, size: r.size });
      }
    segs = full ? added : [...st.segs, ...added];
    if (dropMedia) {
      media = {}; // #259 switched off: no longer listed, the server deletes them
      idx = undefined;
    }
    await save();
  } else await kv.set(STATE, { ...st, at: Date.now() });

  // #259: media keeps its parts across runs and compactions; Wi-Fi only; newest first in the room
  // the quota leaves. Committed every few files, so an interrupted first run keeps its progress.
  if (withMedia) {
    const rowBytes = segs.reduce((n, x) => n + (x.size ?? 0), 0);
    const pick = pickMedia(want, QUOTA * MEDIA_ROOM - rowBytes - PLAIN_MAX);
    await syncMedia(key, media, pick, async (m) => {
      media = m;
      idx = Object.keys(m).length ? await upload(key, { v: 1, media: m } satisfies MediaIndex) : undefined;
      await save();
    });
  }
  return { rows: nRows, bytes };
}

let running: Promise<unknown> | null = null;
/** App start / foreground: daily, on Wi-Fi unless allowed on mobile data. Quiet, never throws. */
export function backupIfDue(now = Date.now()) {
  running ??= (async () => {
    const p = await prefs();
    if (!p.on || (!p.cellular && !unmetered())) return;
    if (now - (await lastRun()) < DAY) return;
    await backupNow();
  })()
    .catch(() => {})
    .finally(() => (running = null));
  return running;
}

export async function turnOn(cellular = false) {
  await kv.set(PREFS, { ...(await prefs()), on: true, cellular } satisfies Prefs);
  await kv.set(STATE, null);
  return backupNow({ full: true });
}

export async function setCellular(cellular: boolean) {
  await kv.set(PREFS, { ...(await prefs()), cellular });
}

/** #259 Photos and videos in the backup (default off). Takes effect at the next run. */
export async function setMedia(media: boolean) {
  await kv.set(PREFS, { ...(await prefs()), media });
}

/** Off: the server deletes the backup and every segment at once. */
export async function turnOff() {
  await api('DELETE', '/me/backup').catch((e) => {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  });
  await kv.set(PREFS, { on: false, cellular: false } satisfies Prefs);
  await kv.set(STATE, null);
}

export type Info = { bytes: number; segments: number; updated_at: string } | null;
export const info = () => api<Info & object>('GET', '/me/backup').catch(() => null);

export class WrongWords extends Error {}

// "You're back" (before the app opens): the person asked for their chats; Chats runs the restore.
const PENDING = 'thirstr.restorePending';
export const requestRestore = () => AsyncStorage.setItem(PENDING, '1').catch(() => {});
export const restorePending = async () => (await AsyncStorage.getItem(PENDING).catch(() => null)) === '1';
export const clearRestorePending = () => AsyncStorage.removeItem(PENDING).catch(() => {});

/**
 * Restore (R-01.15): newest segments land last, so a later row wins; tombstones apply in order.
 * `vault` = key from the words when this phone has none yet (kept only if it opens the backup).
 */
/** #261: checks typed words open this account's backup, then keeps the vault key on this phone. */
export async function unlock(vault: Uint8Array) {
  const r = await api<{ manifest: string }>('GET', '/me/backup/manifest');
  try {
    openBox<Manifest>(chatKey(vault), fromB64(r.manifest));
  } catch {
    throw new WrongWords();
  }
  await keepVaultKey(vault);
}

export async function restore(opts: { vault?: Uint8Array; onProgress?: (done: number, total: number) => void } = {}) {
  const vault = opts.vault ?? (await vaultKey());
  if (!vault) throw new WrongWords();
  const key = chatKey(vault);
  const r = await api<{ manifest: string; segments: { id: string; size: number; url: string }[] }>('GET', '/me/backup/manifest');
  let manifest: Manifest;
  try {
    manifest = openBox<Manifest>(key, fromB64(r.manifest));
  } catch {
    throw new WrongWords();
  }
  if (opts.vault) await keepVaultKey(opts.vault);
  const urls = new Map(r.segments.map((s) => [s.id, s.url]));
  let chats = 0;
  let messages = 0;
  for (const [i, ref] of manifest.segs.entries()) {
    const url = urls.get(ref.id);
    if (!url) continue;
    const box = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (hex(sha256(box)) !== ref.sha) throw new Error('segment changed');
    const seg = openBox<Segment>(key, box);
    const got = await E.importHistory(seg.convs, seg.rows, seg.tomb);
    chats += got.chats;
    messages += got.messages;
    opts.onProgress?.(i + 1, manifest.segs.length + (manifest.idx ? 1 : 0));
  }
  // #259: media files, oldest first so the newest stay in the phone's media cache.
  let media = 0;
  const idxUrl = manifest.idx && urls.get(manifest.idx.id);
  if (manifest.idx && idxUrl) {
    const box = new Uint8Array(await (await fetch(idxUrl)).arrayBuffer());
    if (hex(sha256(box)) !== manifest.idx.sha) throw new Error('segment changed');
    const list = Object.entries(openBox<MediaIndex>(key, box).media).sort((a, b) => a[1].at - b[1].at);
    for (const [blob, m] of list) {
      if (m.exp && m.exp < Date.now()) continue;
      if (await MediaCache.sizeOf(blob)) continue;
      try {
        const parts: Uint8Array[] = [];
        for (const ref of m.parts) {
          const u = urls.get(ref.id);
          if (!u) throw new Error('missing');
          const pb = new Uint8Array(await (await fetch(u)).arrayBuffer());
          if (hex(sha256(pb)) !== ref.sha) throw new Error('segment changed');
          parts.push(openMedia(key, pb));
        }
        await MediaCache.put(blob, concat(...parts), { exp: m.exp });
        media++;
      } catch {
        // one file that can't come back doesn't stop the others
      }
    }
    opts.onProgress?.(manifest.segs.length + 1, manifest.segs.length + 1);
  }
  return { chats, messages, media, at: manifest.at };
}

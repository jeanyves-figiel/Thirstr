// F-01 R-01.15 (#146) opt-in chat backup, sealed with a key only the recovery phrase unlocks.
// key = HKDF-SHA256(vault key, salt "thirstr-chats-v1"). Append-only segments (deflated JSON,
// AES-256-GCM, random IV, AAD "thirstr-chats-v1") hold new message rows + tombstones since the
// last run; a sealed manifest lists the segments with their SHA-256 (order + integrity).
// Compaction rewrites everything as fresh segments when > 200 segments or > 30 % tombstones.
// Never backed up: view-once media, chats whose disappearing timer is under 24 h, franking raw.
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

const AAD = utf8('thirstr-chats-v1');
const PLAIN_MAX = 4 * 1024 * 1024; // before deflate; the server takes ≤ 4.5 MiB ciphertext
const DAY = 86_400_000;
const STATE = 'backup.state';
const PREFS = 'backup.prefs';

export type Prefs = { on: boolean; cellular: boolean };
type SegRef = { id: string; sha: string };
/** `ids`: per chat, the message ids already in the backup (to find new rows and deletions). */
type State = { segs: SegRef[]; ids: Record<string, string[]>; tomb: number; rows: number; at: number; bytes: number };
type Segment = { v: 1; convs: E.Conv[]; rows: Record<string, E.Msg[]>; tomb: Record<string, string[]> };
type Manifest = { v: 1; segs: SegRef[]; at: number };

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

async function upload(key: Uint8Array, seg: Segment): Promise<SegRef & { size: number }> {
  const box = sealBox(key, seg);
  const sha = sha256(box);
  const r = await api<{ id: string; upload_url: string }>('POST', '/me/backup/segments', { size: box.length, sha256: toB64(sha) });
  const put = await fetch(r.upload_url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: box as unknown as BodyInit });
  if (!put.ok) throw new Error('upload failed');
  return { id: r.id, sha: hex(sha), size: box.length };
}

async function commit(key: Uint8Array, segs: SegRef[]) {
  const manifest: Manifest = { v: 1, segs, at: Date.now() };
  return api<{ bytes: number; updated_at: string }>('PUT', '/me/backup/manifest', { manifest: toB64(sealBox(key, manifest)), segments: segs.map((s) => s.id) });
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

  const rows: Record<string, E.Msg[]> = {};
  const tomb: Record<string, string[]> = {};
  const ids: Record<string, string[]> = {};
  let total = 0;
  for (const c of convs) {
    const have = new Set(full ? [] : (st.ids[c.id] ?? []));
    const list = (await E.messages(c.id)).map((m) => keep(c, m)).filter((m): m is E.Msg => !!m);
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
  if (!full && !nRows && !nTomb) {
    await kv.set(STATE, { ...st, at: Date.now() });
    return { rows: 0, bytes: st.bytes };
  }

  const added: SegRef[] = [];
  for (const seg of pack(convs, rows, tomb)) {
    const r = await upload(key, seg);
    added.push({ id: r.id, sha: r.sha });
  }
  const segs = full ? added : [...st.segs, ...added];
  const res = await commit(key, segs);
  await kv.set(STATE, { segs, ids, tomb: full ? 0 : st.tomb + nTomb, rows: total, at: Date.now(), bytes: res.bytes } satisfies State);
  return { rows: nRows, bytes: res.bytes };
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
  await kv.set(PREFS, { on: true, cellular } satisfies Prefs);
  await kv.set(STATE, null);
  return backupNow({ full: true });
}

export async function setCellular(cellular: boolean) {
  await kv.set(PREFS, { ...(await prefs()), cellular });
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
    opts.onProgress?.(i + 1, manifest.segs.length);
  }
  return { chats, messages, at: manifest.at };
}

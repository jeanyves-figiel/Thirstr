// F-01 R-01.14 (#146) chat history to a new phone, right after a device link (R-01.6).
// Both phones make a one-time X25519 key; the public halves travel with the link. Key =
// HKDF-SHA256(ECDH, salt "thirstr-xfer-v1", info "key"); both screens show the same 6-digit code
// (from both public keys) so a swapped key is seen. The old phone streams sealed chunks
// (≤ 4 MiB JSON, deflated, AES-256-GCM, AAD "thirstr-xfer-v1" ‖ transfer id ‖ n) through the
// server; the new phone commits each chunk to its store, then acks (the server deletes it).
// Rows keep their message id, so a retried or restarted transfer never duplicates anything.
import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { deflateSync, inflateSync } from 'fflate';
import { api, ApiError } from '../api/client';
import { concat, fromB64, fromB64url, fromUtf8, rand, toB64, toB64url, utf8 } from './bytes';
import * as E from './engine';
import * as MediaCache from './mediaCache';

const AAD = 'thirstr-xfer-v1';
const PLAIN_MAX = 3 * 1024 * 1024; // JSON before deflate (media parts are base64)
const PART = 2 * 1024 * 1024; // raw media bytes per part
const HOUR = 3_600_000;
const YEAR = 365 * 86_400_000;

export type Keys = { priv: Uint8Array; pub: string };
export type Range = 'all' | 'year';
type MediaPart = { blob: string; part: number; of: number; b64: string; exp?: number };
type Chunk = { v: 1; convs: E.Conv[]; rows: Record<string, E.Msg[]>; media: MediaPart[] };

export function newKeys(): Keys {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: toB64url(x25519.getPublicKey(priv)) };
}

/** Same code on both phones: 6 digits from SHA-256(old pub ‖ new pub). */
export function matchCode(oldPub: string, newPub: string): string {
  const h = sha256(concat(fromB64url(oldPub), fromB64url(newPub)));
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, '0').replace(/^(\d{3})(\d{3})$/, '$1 $2');
}

export function sessionKey(mine: Keys, peerPub: string): Uint8Array {
  return hkdf(sha256, x25519.getSharedSecret(mine.priv, fromB64url(peerPub)), utf8(AAD), utf8('key'), 32);
}

const aad = (id: string, n: number) => utf8(`${AAD}|${id}|${n}`);
export function seal(key: Uint8Array, id: string, n: number, c: Chunk): Uint8Array {
  const iv = rand(12);
  return concat(iv, gcm(key, iv, aad(id, n)).encrypt(deflateSync(utf8(JSON.stringify(c)), { level: 6 })));
}
export function open(key: Uint8Array, id: string, n: number, box: Uint8Array): Chunk {
  return JSON.parse(fromUtf8(inflateSync(gcm(key, box.slice(0, 12), aad(id, n)).decrypt(box.slice(12))))) as Chunk;
}

/** What moves: no view-once, nothing that disappears within the hour, no franking plaintext. */
export function keep(c: E.Conv, m: E.Msg, since: number, now = Date.now()): E.Msg | null {
  if (m.at < since) return null;
  if (m.p.t === 'media' && m.p.media.once) return null;
  const end = E.expiresAt(c, m);
  if (end && end - now < HOUR) return null;
  if (m.status === 'sending' || m.status === 'failed') return null;
  const { raw: _raw, ...rest } = m;
  return rest;
}

type Plan = { convs: E.Conv[]; rows: Record<string, E.Msg[]>; blobs: { blob: string; size: number; exp?: number }[] };
export type Estimate = { chats: number; messages: number; textBytes: number; mediaBytes: number; media: number };

/** Newest chats first; media = files this phone already has (cached ciphertext). */
export async function plan(range: Range, now = Date.now()): Promise<Plan> {
  const since = range === 'year' ? now - YEAR : 0;
  const convs: E.Conv[] = [];
  const rows: Record<string, E.Msg[]> = {};
  const blobs: Plan['blobs'] = [];
  for (const c of E.getConvs().filter((x) => !x.gone)) {
    const list = (await E.messages(c.id)).map((m) => keep(c, m, since, now)).filter((m): m is E.Msg => !!m);
    if (!list.length) continue;
    convs.push(c);
    rows[c.id] = list;
    for (const m of list) {
      if (m.p.t !== 'media') continue;
      const size = await MediaCache.sizeOf(m.p.media.blob);
      if (size) blobs.push({ blob: m.p.media.blob, size, exp: m.p.media.exp });
    }
  }
  return { convs, rows, blobs };
}

export function estimate(p: Plan): Estimate {
  const messages = Object.values(p.rows).reduce((n, l) => n + l.length, 0);
  // deflated JSON is about a third of its length
  const textBytes = Math.round(JSON.stringify(p.rows).length / 3);
  return { chats: p.convs.length, messages, textBytes, mediaBytes: p.blobs.reduce((n, b) => n + b.size, 0), media: p.blobs.length };
}

/** Splits the plan into chunks: rows first (chat by chat), then media in parts. */
export async function* chunks(p: Plan, withMedia: boolean): AsyncGenerator<Chunk> {
  let cur: Chunk = { v: 1, convs: p.convs, rows: {}, media: [] };
  let size = JSON.stringify(p.convs).length;
  const flush = () => {
    const out = cur;
    cur = { v: 1, convs: [], rows: {}, media: [] };
    size = 0;
    return out;
  };
  for (const [cid, list] of Object.entries(p.rows)) {
    for (const m of list) {
      const n = JSON.stringify(m).length + 1;
      if (size + n > PLAIN_MAX && size > 0) yield flush();
      (cur.rows[cid] ??= []).push(m);
      size += n;
    }
  }
  if (withMedia) {
    for (const b of p.blobs) {
      const ct = await MediaCache.get(b.blob).catch(() => null);
      if (!ct) continue;
      const of = Math.max(1, Math.ceil(ct.length / PART));
      for (let part = 0; part < of; part++) {
        const b64 = toB64(ct.slice(part * PART, (part + 1) * PART));
        if (size + b64.length > PLAIN_MAX && size > 0) yield flush();
        cur.media.push({ blob: b.blob, part, of, b64, exp: b.exp });
        size += b64.length + 100;
      }
    }
  }
  if (size > 0 || Object.keys(cur.rows).length || cur.convs.length) yield flush();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Progress = { sent: number; acked: number; bytes: number; total?: number; state: 'sending' | 'paused' | 'done' | 'failed' | 'cancelled' };

/**
 * Old phone. Returns a controller; `onProgress` gets server-side progress. At most 6 chunks are
 * unacknowledged at once (the server allows 8), so a slow new phone throttles the old one.
 */
export function send(opts: { linkCode: string; keys: Keys; peerPub: string; plan: Plan; withMedia: boolean; onProgress: (p: Progress) => void }) {
  const key = sessionKey(opts.keys, opts.peerPub);
  let paused = false;
  let stopped = false;
  let id: string | null = null;
  const est = estimate(opts.plan);

  const run = (async () => {
    let created: { id: string } | null = null;
    for (let i = 0; i < 30 && !created && !stopped; i++) {
      created = await api<{ id: string }>('POST', '/devices/transfer', { link_code: opts.linkCode, estimate_bytes: est.textBytes + (opts.withMedia ? est.mediaBytes : 0) }).catch(async (e) => {
        if (e instanceof ApiError && e.code === 'not_ready') {
          await wait(2000);
          return null;
        }
        throw e;
      });
    }
    if (!created) throw new Error('not ready');
    id = created.id;
    let n = 0;
    let acked = 0;
    let bytes = 0;
    for await (const c of chunks(opts.plan, opts.withMedia)) {
      while ((paused || n - acked >= 6) && !stopped) {
        await wait(paused ? 500 : 800);
        const s = await api<{ acked: number }>('GET', `/devices/transfer/${id}`).catch(() => null);
        if (s) acked = s.acked;
        opts.onProgress({ sent: n, acked, bytes, state: paused ? 'paused' : 'sending' });
      }
      if (stopped) return;
      const box = seal(key, id, n, c);
      const slot = await api<{ upload_url: string }>('POST', `/devices/transfer/${id}/chunks`, { n, size: box.length });
      const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: box as unknown as BodyInit });
      if (!put.ok) throw new Error('upload failed');
      await api('POST', `/devices/transfer/${id}/chunks/${n}/ready`);
      n++;
      bytes += box.length;
      opts.onProgress({ sent: n, acked, bytes, state: 'sending' });
    }
    await api('POST', `/devices/transfer/${id}/done`, { total: n });
    while (acked < n && !stopped) {
      await wait(1000);
      const s = await api<{ acked: number; state: string }>('GET', `/devices/transfer/${id}`).catch((e) => (e instanceof ApiError && e.status === 404 ? { acked: n, state: 'done' } : null));
      if (s) acked = s.acked;
      opts.onProgress({ sent: n, acked, bytes, total: n, state: acked >= n ? 'done' : 'sending' });
    }
  })().catch((e) => {
    if (!stopped) opts.onProgress({ sent: 0, acked: 0, bytes: 0, state: 'failed' });
    throw e;
  });

  return {
    done: run,
    pause: (p: boolean) => {
      paused = p;
    },
    cancel: async () => {
      stopped = true;
      if (id) await api('DELETE', `/devices/transfer/${id}`).catch(() => {});
      opts.onProgress({ sent: 0, acked: 0, bytes: 0, state: 'cancelled' });
    },
  };
}

// ---------------------------------------------------------------- new phone

/** Set by the link screen once the session exists; Chats picks it up (in memory, 2 h). */
let incoming: { keys: Keys; oldPub: string; until: number } | null = null;
export const expect = (keys: Keys, oldPub: string) => {
  incoming = { keys, oldPub, until: Date.now() + 2 * HOUR };
};
export const expecting = () => !!incoming && incoming.until > Date.now();

export type Received = { chats: number; messages: number; media: number; chunks: number };

/** Applies one chunk: rows into the store, media parts into the media cache once complete. */
export async function apply(c: Chunk, parts: Map<string, (Uint8Array | null)[]>): Promise<Omit<Received, 'chunks'>> {
  const got = await E.importHistory(c.convs, c.rows);
  let media = 0;
  for (const p of c.media) {
    const list = parts.get(p.blob) ?? Array<Uint8Array | null>(p.of).fill(null);
    list[p.part] = fromB64(p.b64);
    parts.set(p.blob, list);
    if (list.every(Boolean)) {
      await MediaCache.put(p.blob, concat(...(list as Uint8Array[])), { exp: p.exp });
      parts.delete(p.blob);
      media++;
    }
  }
  return { chats: got.chats, messages: got.messages, media };
}

/** New phone: polls (1.5 s) while a transfer is expected, applies chunks in order, acks each. */
export async function receive(onProgress: (r: Received & { sent: number; total?: number; estimate: number; bytes: number }) => void, alive: () => boolean) {
  if (!incoming) return null;
  const key = sessionKey(incoming.keys, incoming.oldPub);
  const parts = new Map<string, (Uint8Array | null)[]>();
  const tot: Received = { chats: 0, messages: 0, media: 0, chunks: 0 };
  let seen = false;
  let next = 0;
  while (alive() && expecting()) {
    const t = await api<{ id: string; total: number | null; sent: number; estimate: number; bytes: number; chunks: { n: number; url: string }[] }>('GET', '/devices/transfer/incoming').catch((e) => (e instanceof ApiError && e.status === 404 ? null : undefined));
    if (t === null) {
      if (seen) break; // finished (or cancelled) after it started
      await wait(1500);
      continue;
    }
    if (!t) {
      await wait(3000);
      continue;
    }
    seen = true;
    const ready = t.chunks.filter((c) => c.n >= next).sort((a, b) => a.n - b.n);
    for (const c of ready) {
      if (c.n !== next) break; // keep order
      const box = new Uint8Array(await (await fetch(c.url)).arrayBuffer());
      const r = await apply(open(key, t.id, c.n, box), parts);
      tot.chats += r.chats;
      tot.messages += r.messages;
      tot.media += r.media;
      tot.chunks++;
      next++;
      await api('POST', `/devices/transfer/${t.id}/ack`, { n: [c.n] });
      onProgress({ ...tot, sent: t.sent, total: t.total ?? undefined, estimate: t.estimate, bytes: t.bytes });
    }
    if (t.total != null && next >= t.total) break;
    if (!ready.length) await wait(1500);
  }
  if (alive()) incoming = null; // finished; a card that unmounts mid-way leaves it for the next one
  return tot;
}

export function _reset() {
  incoming = null;
}

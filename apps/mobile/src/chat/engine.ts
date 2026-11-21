// Chat engine (F-07): conversations on the device, MLS via mls.ts, delivery via the API.
// The server sees ciphertext, profile ids and device ids only (AC-07.1).
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Socket } from 'phoenix';
import { AppState, Platform } from 'react-native';
import { accessToken, api, API_BASE, ApiError, Me } from '../api/client';
import type { ProfileView } from '../api/types';
import { fromB64, fromUtf8, hex, rand, toB64, utf8 } from './bytes';
import { kv } from './kv';
import * as Recent from './recent';
import { clearTemp as clearTempVideos } from './video';
import * as MediaCache from './mediaCache';
import * as mls from './mls';
import * as store from './store';
import * as people from './people';
import * as floc from './friendLoc';
import * as vc from './vcheck';
import { vcx } from '../i18n/vcheck';
import { ppl } from '../i18n/people';
import { getLocal } from '../me/localFields';

export type Ttl = '24h' | '7d' | 'never';
export const TTL_S: Record<Ttl, number | null> = {
  '24h': 86400,
  '7d': 7 * 86400,
  never: null,
};

export type MediaRef = {
  blob: string;
  key: string;
  iv: string;
  mime: string;
  w?: number;
  h?: number;
  once?: boolean;
  exp?: number;
  save?: boolean;
  /** Videos (#138): length in seconds. */
  dur?: number;
  /** Ciphertext size in bytes (#177, Data saver decides what loads by itself). */
  size?: number;
};
/** Album item; videos (#138) carry `dur` (s) and their size. */
export type AlbumItem = { blob: string; key: string; iv: string; mime: string; w?: number; h?: number; dur?: number };

export type Re = { id: string; n: string; s: string };

/** Plaintext inside MLS application messages (R-07.4). */
export type Payload =
  /** F-19 G1 (#187): `re` = the message this one replies to (id, sender name as the writer saw it, ≤ 80-char snippet). */
  | { t: 'text'; text: string; re?: Re }
  /** `k` = index of a built-in quick reply (R-07.31): the reader shows it in their own language. */
  | { t: 'quick_reply'; text: string; k?: number }
  | { t: 'media'; media: MediaRef }
  | { t: 'read'; upTo: string }
  | { t: 'delivered'; upTo: string }
  /** R-07.20: the sender of this replaces a broken 1:1 group; the receiver forgets `drop`. */
  | { t: 'resync'; drop: string }
  /** Local only, never sent: R-07.20 undecryptable / R-07.22 expired while away. */
  | { t: 'notice'; kind: 'undecryptable' | 'expired'; n?: number }
  | { t: 'disappearing'; ttl: Ttl }
  | { t: 'reaction'; to: string; emoji: string }
  | {
      t: 'album.grant';
      album: string;
      name: string;
      items: AlbumItem[];
      until?: number;
    }
  | { t: 'album.revoke'; album: string }
  | { t: 'profile.private'; fields: Record<string, unknown> }
  | { t: 'location.share'; lat: number; lng: number; until: number }
  | { t: 'screenshot' }
  /** F-07 R-07.36 (#115): mutual friends, only inside the 1:1 E2EE chat. */
  | { t: 'friend'; op: people.FriendOp }
  /** #247 R-07.46: trusted-contact invite link (F-13 R-13.2) sent inside the chat. */
  | { t: 'safety.invite'; url: string }
  /** #247 R-07.49: party invite from its host (F-10). */
  | { t: 'party.invite'; party: string; code?: string; title: string; starts_at: string }
  /** #247 R-07.47: friend location for the map, silent, never stored as a message. */
  | floc.FriendLoc
  /** F-18 R-18.8–R-18.16 (#159): video check, only inside the 1:1 E2EE chat. */
  | vc.VcPayload;

export type Msg = {
  id: string;
  from: 'me' | 'them';
  at: number;
  p: Payload;
  status?: 'sending' | 'sent' | 'delivered' | 'failed' | 'read';
  readAt?: number;
  /** Group chats: who read it (count shown, never names; R-07.23). */
  readBy?: string[];
  /** Arrival order (store.ts). */
  seq?: number;
  opened?: boolean;
  fk?: string;
  /** Group chats: sender profile id. */
  by?: string;
  /** Received messages: exact plaintext (b64) so a report can open the franking commitment (R-07.11). */
  raw?: string;
};

export type Conv = {
  id: string;
  me: string;
  peer: string;
  groups: string[];
  name: string;
  age?: number;
  photo: string | null;
  verified: boolean;
  lastAt: number;
  last: string;
  unread: number;
  theyWrote: boolean;
  iWrote: boolean;
  /** Group chats only since #115: pinned on top. 1:1 chats use favorites (people.ts). */
  starred?: boolean;
  /** Last known online state of the peer (#115, from GET /profiles/:id). */
  online?: boolean;
  muted?: boolean;
  archived?: boolean;
  ttl: Ttl;
  gone?: boolean;
  peerFields?: Record<string, unknown>;
  privSent?: string;
  /** Group chats (party guest chat, activity, club): "party:<id>" etc. */
  ctx?: string;
  host?: boolean;
  names?: Record<string, string>;
  /** R-07.23 per-chat override: 'off' = no Delivered / Read / typing either way in this chat. */
  receipts?: 'off';
  /** F-07 R-07.27 per-chat switch, device only: 'off' = no translation in this chat. */
  translate?: 'off';
};

/** Group chats only (inside the E2EE payload): `n` sender display name, `g` group title. */
type Wire = Payload & { v: 1; id: string; at: number; fk: string; n?: string; g?: string };

// ------------------------------------------------------------------ tiny event bus

type Fn = () => void;
const subs = new Map<string, Set<Fn>>();
export function on(topic: string, fn: Fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic)!.add(fn);
  return () => {
    subs.get(topic)!.delete(fn);
  };
}
const emit = (topic: string) => subs.get(topic)?.forEach((f) => f());

// ------------------------------------------------------------------ state

let me: Me | null = null;
let device: string | null = null;
let convs: Record<string, Conv> = {};
const typing: Record<string, number> = {};
let socket: Socket | null = null;
let pulling: Promise<void> | null = null;
let again = false;

const convId = (mine: string, peer: string) => `${mine}:${peer}`;
const saveConvs = () => kv.set('convs', convs).then(() => emit('convs'));
export const getConvs = () => Object.values(convs).sort((a, b) => b.lastAt - a.lastAt);
export const getConv = (id: string) => convs[id];
export const isTyping = (id: string) => (typing[id] ?? 0) > Date.now() - 6000;
export const unreadTotal = () => Object.values(convs).reduce((n, c) => n + (c.archived || c.muted ? 0 : c.unread > 0 ? 1 : 0), 0);

/** Messages of a conversation, oldest first (R-07.21: no cap). */
export function messages(id: string): Promise<Msg[]> {
  return store.all<Msg>(id);
}

/** Changes one conversation's messages under its lock; `fn` returns rows to write / ids to delete. */
function edit(cid: string, fn: (list: Msg[]) => { put?: Msg[]; del?: string[] } | void | Promise<{ put?: Msg[]; del?: string[] } | void>) {
  return store.lock('c:' + cid, async () => {
    const r = (await fn(await store.all<Msg>(cid))) || {};
    for (const m of r.put ?? []) await store.put(cid, m);
    await store.remove(cid, r.del ?? []);
    if (r.put?.length || r.del?.length) emit('msgs:' + cid);
  });
}

/**
 * F-01 R-01.14 / R-01.15 (#146): history from the old phone or the chat backup. A chat that is
 * already here keeps its state; rows already here win (same message id = no-op); tombstones
 * remove what was deleted before the backup.
 */
export async function importHistory(cs: Conv[], rows: Record<string, Msg[]>, tomb: Record<string, string[]> = {}) {
  let added = 0;
  for (const c of cs) {
    if (convs[c.id]) continue;
    convs[c.id] = { ...c, unread: 0 };
    added++;
  }
  if (added) await saveConvs();
  let n = 0;
  for (const [cid, list] of Object.entries(rows)) {
    if (!convs[cid]) continue;
    await edit(cid, (have) => {
      const ids = new Set(have.map((m) => m.id));
      const gone = new Set(tomb[cid] ?? []);
      const put = list.filter((m) => !ids.has(m.id) && !gone.has(m.id));
      n += put.length;
      return { put, del: [...gone].filter((id) => ids.has(id)) };
    });
  }
  for (const [cid, ids] of Object.entries(tomb)) if (!rows[cid] && convs[cid]) await edit(cid, () => ({ del: ids }));
  return { chats: added, messages: n };
}

/** R-07.23: receipts (Delivered, Read, typing) on for this chat, both ways. */
export const receiptsOn = (c: Conv) => me?.settings?.read_receipts !== false && c.receipts !== 'off';

// ------------------------------------------------------------------ lifecycle

/** Starts the engine for the signed-in account: key packages, realtime, first pull. */
export async function start(account: Me) {
  me = account;
  store.reset();
  convs = (await kv.get<Record<string, Conv>>('convs')) ?? {};
  await people.loadPeople();
  await vc.loadVc();
  await migrateStars();
  emit('convs');
  await ensureKeyPackages().catch(() => {});
  connect();
  registerPush().catch(() => {});
  pull();
  drain();
  // EN-18: no work while backgrounded; foreground runs a sweep anyway.
  sweepTimer ??= setInterval(() => AppState.currentState === 'active' && sweepExpired(), 60_000);
  sweepExpired();
  // R-07.17: foreground (also after a push wake) pulls and drains the outbox.
  appSub ??= AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      pull();
      drain();
      sweepExpired();
    }
  });
}

/** R-07.32: a starred 1:1 chat becomes a favorite of its peer once; groups keep `starred` as Pin. */
async function migrateStars() {
  let changed = false;
  for (const c of Object.values(convs)) {
    if (!c.starred || c.ctx || !c.peer) continue;
    if (!people.isFav(c.peer)) await people.setFav(c.peer, true, { name: c.name, photo: c.photo });
    delete c.starred;
    changed = true;
  }
  if (changed) await saveConvs();
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove: () => void } | null = null;

export function stop() {
  socket?.disconnect();
  socket = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  appSub?.remove();
  appSub = null;
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = null;
  online = false;
  me = null;
  people.resetPeople();
  vc.resetVc();
}

/** Sign-out / account delete: wipe everything on the device (data-model.md › Device-only). */
export async function wipe() {
  stop();
  convs = {};
  // R-08.14: Sent recently files are outside the store; delete them before the index.
  await Recent.clear().catch(() => {});
  await clearTempVideos();
  await MediaCache.clear().catch(() => {}); // SR-05: cached chat media files
  await kv.wipe();
  store.reset();
  emit('convs');
}

const KP_TARGET = 30;
const KP_MIN = 15;

async function ensureKeyPackages() {
  if (!me) return;
  const r = await api<{
    counts: Record<string, { count: number; last_resort: boolean }>;
    device_id: string;
  }>('GET', '/mls/keypackages');
  if (!r.device_id) throw new Error('no device id');
  device = r.device_id;
  for (const [profile, c] of Object.entries(r.counts)) {
    if (c.count >= KP_MIN && c.last_resort) continue;
    const m = { p: profile, d: device };
    const fresh = [];
    for (let i = c.count; i < KP_TARGET; i++) fresh.push(toB64((await mls.newKeyPackage(m)).wire));
    let lastResort: string | undefined;
    if (!c.last_resort) {
      const lr = await mls.newKeyPackage(m);
      await kv.set('kp:lastresort:' + profile, lr.ref);
      lastResort = toB64(lr.wire);
    }
    await api('POST', '/mls/keypackages', {
      profile_id: profile,
      key_packages: fresh,
      last_resort: lastResort,
    });
  }
}

function connect() {
  if (socket) return;
  const url = API_BASE.replace(/^http/, 'ws').replace(/\/v1$/, '') + '/socket';
  let token: string | null = null;
  const s = new Socket(url.startsWith('/') ? `${location.origin.replace(/^http/, 'ws')}${url}` : url, { params: () => ({ token }) });
  const refresh = async () => {
    await api('GET', '/mls/keypackages').catch(() => {});
    token = await accessToken();
  };
  s.onError(() => {
    refresh();
  });
  // R-07.19: connection state drives the "Waiting for network" chip and outbox drains.
  s.onOpen(() => setOnline(true));
  s.onClose(() => setOnline(false));
  refresh().then(() => {
    s.connect();
    // SR-13: env → this device's envelopes arrive on the socket (message.env), or message.pull.
    const ch = s.channel('user:me', { env: true });
    ch.on('message.new', () => pull());
    ch.on('message.pull', () => pull());
    ch.on('message.env', (p: { messages: Incoming[] }) => void receivePushed(p.messages ?? []));
    ch.on('typing', (p: { from_profile_id: string; to_profile_id: string }) => {
      const id = convId(p.to_profile_id, p.from_profile_id);
      if (convs[id]?.receipts === 'off') return; // R-07.23 per-chat override (server checks global)
      typing[id] = Date.now();
      emit('typing:' + id);
    });
    ch.on('tap.new', () => emit('taps'));
    ch.on('tap.mutual', () => emit('taps'));
    // B3: party / activity / club membership changed: hosts re-sync their group chats.
    for (const ev of ['party.request', 'party.accepted', 'party.status', 'activity.join', 'club.request']) ch.on(ev, () => emit('scene'));
    ch.join().receive('ok', () => {
      pull();
      drain();
    });
    chan = ch;
  });
  socket = s;
}

let chan: ReturnType<Socket['channel']> | null = null;
let online = false;

let offSince = Date.now();

function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  if (!v) offSince = Date.now();
  emit('net');
  if (v) drain();
}

/** R-07.19: false while the realtime connection to the server is down. */
export const isOnline = () => online;
export const offlineSince = () => offSince;

async function registerPush() {
  if (Platform.OS !== 'ios') return;
  const N = await import('expo-notifications');
  const perm = await N.getPermissionsAsync();
  if (perm.status !== 'granted') return;
  const t = await N.getDevicePushTokenAsync();
  await api('PUT', '/me/push', { token: t.data, platform: 'ios' });
}

/** R-16.7: ask on first inbound event, after the app's own explanation. */
export async function askPushPermission() {
  if (Platform.OS !== 'ios') return false;
  const N = await import('expo-notifications');
  const r = await N.requestPermissionsAsync();
  if (r.status === 'granted') await registerPush().catch(() => {});
  return r.status === 'granted';
}

// ------------------------------------------------------------------ receive

type Incoming = {
  id: number;
  to_profile_id: string;
  from_profile_id: string;
  group_id: string;
  kind: string;
  ciphertext: string;
  at: string;
};

/** R-07.20: kept when it can't be decrypted yet (may have arrived before its welcome/commit). */
type Pending = { m: Incoming; first: number };
const PENDING_MS = 24 * 3600_000;
const SEEN_MAX = 2000;
const CHAT_TIMEOUT = 10_000;

export function pull(): Promise<void> {
  if (pulling) {
    again = true;
    return pulling;
  }
  pulling = (async () => {
    try {
      do {
        again = false;
        const r = await api<{ messages: Incoming[]; expired?: { group_id: string; count: number }[] }>('GET', '/mls/messages', undefined, true, CHAT_TIMEOUT);
        for (const x of r.expired ?? []) await noticeExpired(x.group_id, x.count);
        if (!r.messages.length) break;
        const { done, inbound } = await ingest(r.messages);
        await ackIds(done);
        await retryPending();
        for (const cid of inbound) sendDelivered(cid);
        if (r.messages.length === 200) again = true;
      } while (again);
      await retryPending();
    } catch {
      // offline: next socket event / foreground retries
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

/** Handles fetched or pushed envelopes; ids returned are safe to ack (stored on disk first, R-07.20). */
async function ingest(msgs: Incoming[]): Promise<{ done: number[]; inbound: Set<string> }> {
  // Server ids already handled (a kill between handling and ack re-delivers them).
  const seen = new Set((await kv.get<number[]>('seen')) ?? []);
  const done: number[] = [];
  const inbound = new Set<string>();
  for (const m of msgs) {
    if (!seen.has(m.id)) {
      const res = await handle(m);
      if (res === 'pending') await addPending(m);
      else if (res) inbound.add(res);
      seen.add(m.id);
      // Durable before the ack (R-07.20): handled ids, rows and pending are on disk now.
      await kv.set('seen', [...seen].slice(-SEEN_MAX));
    }
    done.push(m.id);
  }
  return { done, inbound };
}

/** SR-13: ack over the socket when it is up (no extra request), REST otherwise or on failure. */
function ackIds(ids: number[]): Promise<void> {
  if (!ids.length) return Promise.resolve();
  const rest = () => api('POST', '/mls/messages/ack', { ids }, true, CHAT_TIMEOUT).then(() => undefined);
  const ch = chan;
  if (!ch || !online) return rest();
  return new Promise<void>((resolve, reject) => {
    const fallback = () => rest().then(resolve, reject);
    ch.push('ack', { ids }, CHAT_TIMEOUT)
      .receive('ok', () => resolve())
      .receive('error', fallback)
      .receive('timeout', fallback);
  });
}

/**
 * SR-13 (#153): envelopes pushed on the socket (`message.env`), so a message costs no GET.
 * Runs in the same lane as pull(); anything that fails falls back to a REST pull (the server
 * keeps every envelope until it is acked).
 */
export function receivePushed(msgs: Incoming[]): Promise<void> {
  if (pulling) {
    again = true; // not acked yet: the running pull's next round fetches them
    return pulling;
  }
  let failed = false;
  pulling = (async () => {
    try {
      const { done, inbound } = await ingest(msgs);
      await ackIds(done);
      await retryPending();
      for (const cid of inbound) sendDelivered(cid);
    } catch {
      failed = true;
    } finally {
      pulling = null;
    }
    if (failed || again) {
      again = false;
      await pull();
    }
  })();
  return pulling;
}

/**
 * Returns the conversation id when a visible inbound message was added, 'pending' when it
 * can't be decrypted yet, or null when there is nothing more to do.
 */
async function handle(m: Incoming): Promise<string | 'pending' | null> {
  const wire = fromB64(m.ciphertext);
  const gid = hex(fromB64(m.group_id));
  if (m.kind === 'welcome') {
    let j: Awaited<ReturnType<typeof mls.join>> = null;
    try {
      j = await mls.join(wire);
    } catch {
      return null; // not for a key package we hold: nothing can ever open it
    }
    if (!j) return null;
    // R-01.6: my other device added this one to a 1:1 chat → the peer is the other profile in the group.
    const peer = m.from_profile_id === m.to_profile_id ? j.members.find((x) => x.p !== m.to_profile_id)?.p : m.from_profile_id;
    if (!j.ctx && !peer) return null;
    const c = j.ctx ? await ensureGroupConv(j.ctx, m.to_profile_id) : await ensureConv(m.to_profile_id, peer!);
    // Both sides may create a group at once: keep both, send on the lowest id (deterministic).
    if (!c.groups.includes(j.groupId)) c.groups = [...c.groups, j.groupId].sort();
    await kv.set('g2c:' + j.groupId, c.id);
    await saveConvs();
    return null;
  }
  if (m.kind === 'commit') {
    try {
      await mls.open(gid, wire);
      return null;
    } catch {
      return 'pending';
    }
  }
  if (m.kind !== 'app') return null;
  let plain: Uint8Array | null;
  try {
    plain = await mls.open(gid, wire);
  } catch {
    return 'pending';
  }
  if (!plain) return null;
  const w = JSON.parse(fromUtf8(plain)) as Wire;
  const cid = (await kv.get<string>('g2c:' + gid)) ?? convId(m.to_profile_id, m.from_profile_id);
  if (!convs[cid]) await ensureConv(m.to_profile_id, m.from_profile_id);
  if (w.t === 'resync') {
    await dropGroup(cid, w.drop, gid);
    return null;
  }
  const fresh = await receive(cid, w, Date.parse(m.at) || 0, m.from_profile_id, toB64(plain));
  return fresh ? cid : null;
}

async function addPending(m: Incoming) {
  const list = (await kv.get<Pending[]>('pending')) ?? [];
  if (!list.some((x) => x.m.id === m.id)) list.push({ m, first: Date.now() });
  await kv.set('pending', list);
}

/** Retries kept messages in server order; after 24 h shows a notice and re-syncs the 1:1 group. */
async function retryPending() {
  let list = (await kv.get<Pending[]>('pending')) ?? [];
  if (!list.length) return;
  for (let pass = 0; pass < 3 && list.length; pass++) {
    const keep: Pending[] = [];
    let progress = false;
    for (const x of list.sort((a, b) => a.m.id - b.m.id)) {
      const res = await handle(x.m);
      if (res !== 'pending') {
        progress = true;
        if (res) sendDelivered(res);
      } else if (Date.now() - x.first > PENDING_MS) {
        await giveUp(x.m);
      } else keep.push(x);
    }
    list = keep;
    await kv.set('pending', list);
    if (!progress) break;
  }
}

async function giveUp(m: Incoming) {
  if (m.kind !== 'app') return; // handshake only: the notice comes with the app message it breaks
  const gid = hex(fromB64(m.group_id));
  const cid = (await kv.get<string>('g2c:' + gid)) ?? convId(m.to_profile_id, m.from_profile_id);
  const c = convs[cid] ?? (await ensureConv(m.to_profile_id, m.from_profile_id));
  await addNotice(c.id, 'undecryptable');
  if (!c.ctx && !c.gone && !resyncing.has(c.id)) {
    resyncing.add(c.id);
    resync(c, gid)
      .catch(() => {})
      .finally(() => resyncing.delete(c.id));
  }
}

const resyncing = new Set<string>();

/** R-07.20: forget the broken 1:1 group, start a new one and tell the peer to drop the old one. */
async function resync(c: Conv, bad: string) {
  await dropGroup(c.id, bad);
  await send(c.id, { t: 'resync', drop: bad }, { silent: true });
}

async function dropGroup(cid: string, gid: string, keep?: string) {
  const c = convs[cid];
  if (!c || gid === keep || !/^[0-9a-f]+$/.test(gid)) return;
  if ((await kv.get<string>('g2c:' + gid)) !== cid && !c.groups.includes(gid)) return;
  await mls.forget(gid);
  await kv.del('g2c:' + gid);
  c.groups = c.groups.filter((g) => g !== gid);
  await saveConvs();
}

async function addNotice(cid: string, kind: 'undecryptable' | 'expired', n?: number) {
  await edit(cid, () => ({ put: [{ id: 'n' + hex(rand(8)), from: 'them', at: Date.now(), p: { t: 'notice', kind, n } }] }));
}

async function noticeExpired(gidB64: string, n: number) {
  const cid = await kv.get<string>('g2c:' + hex(fromB64(gidB64)));
  if (cid && convs[cid]) await addNotice(cid, 'expired', n);
}

const RANK: Record<NonNullable<Msg['status']>, number> = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
/** Status only moves forward (a Delivered can arrive before the send response). */
const up = (cur: Msg['status'], next: NonNullable<Msg['status']>) => (RANK[next] > RANK[cur ?? 'sending'] || (next === 'failed' && RANK[cur ?? 'sending'] < 2) ? next : cur);

/** Returns true when a new visible inbound message was stored. */
async function receive(cid: string, w: Wire, serverAt: number, from?: string, raw?: string): Promise<boolean> {
  const c = convs[cid];
  if (!c) return false;
  const p = stripWire(w);
  // R-07.20: sender time, clamped to [server − 5 min, server] so a wrong phone clock can't reorder.
  const at = serverAt ? Math.min(serverAt, Math.max(w.at || serverAt, serverAt - 5 * 60_000)) : w.at || Date.now();
  // Sent from my other device (R-01.6): shows as mine, no unread.
  const mine = !!from && from === c.me;
  if (c.ctx && from && w.n) c.names = { ...c.names, [from]: w.n.slice(0, 40) };
  if (c.ctx && w.g && c.name === '…') c.name = w.g.slice(0, 60);
  if (p.t === 'read' || p.t === 'delivered') {
    // R-07.23: receipts off (global or this chat) → others' receipts aren't shown either.
    if (mine || !receiptsOn(c)) return false;
    const status = p.t;
    await edit(cid, (list) => {
      const idx = list.findIndex((x) => x.id === p.upTo);
      const out: Msg[] = [];
      for (let i = 0; i <= idx; i++) {
        const x = list[i];
        if (x.from !== 'me') continue;
        const readBy = status === 'read' && c.ctx && from ? [...new Set([...(x.readBy ?? []), from])] : x.readBy;
        const next = { ...x, status: up(x.status, status), readAt: status === 'read' ? (x.readAt ?? Date.now()) : x.readAt, readBy };
        if (next.status !== x.status || next.readBy?.length !== x.readBy?.length) out.push(next);
      }
      return { put: out };
    });
    return false;
  }
  if (p.t === 'friend') {
    // R-07.36: request/accept show as a row; decline, cancel and remove are quiet.
    if (c.ctx || !c.peer) return false;
    const show = await friendOp(c, p.op, mine);
    if (!show) return false;
  }
  if (p.t === 'friend.loc') {
    if (!c.ctx && c.peer && !mine) await floc.receive(c.peer, p);
    return false;
  }
  if (p.t === 'vcheck') {
    // R-18.8–R-18.16: request, clip, confirm and screenshot show as rows; the rest is quiet.
    if (c.ctx || !c.peer) return false;
    if (!(await vc.apply(c.peer, p, mine))) return false;
  }
  switch (p.t) {
    case 'disappearing':
      c.ttl = p.ttl;
      break;
    case 'album.grant':
      await kv.set(`grant:${c.id}:${p.album}`, p);
      break;
    case 'album.revoke':
      await kv.del(`grant:${c.id}:${p.album}`);
      break;
    case 'profile.private':
      c.peerFields = p.fields;
      break;
  }
  let fresh = false;
  await edit(cid, (list) => {
    if (list.some((x) => x.id === w.id)) return;
    fresh = true;
    return { put: [{ id: w.id, from: mine ? 'me' : 'them', status: mine ? 'sent' : undefined, at, p, fk: w.fk, raw, by: c.ctx ? from : undefined }] };
  });
  if (!fresh) {
    await saveConvs();
    return false;
  }
  if (mine) c.iWrote = true;
  else c.theyWrote = true;
  if (p.t !== 'reaction') {
    c.lastAt = Math.max(c.lastAt, at);
    c.last = preview(p);
    if (!mine) c.unread += 1;
    c.archived = false;
  }
  delete typing[cid];
  await saveConvs();
  emit('incoming');
  return !mine && p.t !== 'profile.private';
}

/** R-07.16: one Delivered receipt per chat per batch, 1:1 only, if receipts are on. */
function sendDelivered(cid: string) {
  const c = convs[cid];
  if (!c || c.ctx || !receiptsOn(c)) return;
  messages(cid)
    .then((list) => {
      const last = [...list].reverse().find((m) => m.from === 'them' && m.p.t !== 'notice');
      if (last) return send(cid, { t: 'delivered', upTo: last.id }, { silent: true });
    })
    .catch(() => {});
}

const stripWire = (w: Wire): Payload => {
  const { v: _v, id: _id, at: _at, fk: _fk, n: _n, g: _g, ...p } = w;
  return p as Payload;
};

export function preview(p: Payload): string {
  switch (p.t) {
    case 'text':
    case 'quick_reply':
      return p.text;
    case 'media':
      return '📷';
    case 'album.grant':
      return '🔓 ' + p.name;
    case 'album.revoke':
      return '🔒';
    case 'location.share':
      return '📍';
    case 'disappearing':
      return '⏱';
    case 'friend':
      return p.op === 'accept' ? ppl.previewAccept : ppl.previewRequest;
    case 'safety.invite':
      return '🛡 ' + ppl.previewSafety;
    case 'party.invite':
      return '🎉 ' + p.title;
    case 'vcheck':
      return '◉ ' + vcx.preview;
    default:
      return '';
  }
}

// ------------------------------------------------------------------ conversations

async function ensureConv(mine: string, peer: string): Promise<Conv> {
  const id = convId(mine, peer);
  if (convs[id]) return convs[id];
  const c: Conv = {
    id,
    me: mine,
    peer,
    groups: [],
    name: '…',
    photo: null,
    verified: false,
    lastAt: Date.now(),
    last: '',
    unread: 0,
    theyWrote: false,
    iWrote: false,
    ttl: (me?.settings?.disappearing_default as Ttl) ?? '7d',
  };
  convs[id] = c;
  refreshPeer(c).catch(() => {});
  return c;
}

const groupConvId = (ctx: string, mine: string) => `${ctx}#${mine}`;

async function ensureGroupConv(ctx: string, mine: string, title?: string): Promise<Conv> {
  const id = groupConvId(ctx, mine);
  if (!convs[id]) {
    convs[id] = {
      id,
      me: mine,
      peer: '',
      ctx,
      groups: [],
      name: title ?? '…',
      photo: null,
      verified: false,
      lastAt: Date.now(),
      last: '',
      unread: 0,
      theyWrote: true,
      iWrote: true,
      ttl: 'never',
      names: {},
    };
  }
  if (title) convs[id].name = title;
  await saveConvs();
  return convs[id];
}

/** Opens a party / activity / club chat. */
export async function openGroup(ctx: string, mine: string, title: string, host: boolean): Promise<Conv> {
  const c = await ensureGroupConv(ctx, mine, title);
  c.host = host;
  await saveConvs();
  return c;
}

/**
 * Host only: makes the MLS group match the server's member list (profile ids + names).
 * New members get a welcome, everyone else a commit; removed members are committed out.
 */
export async function syncGroup(cid: string, list: { id: string; name: string }[]) {
  const c = convs[cid];
  if (!c?.ctx || !c.host) return;
  c.names = Object.fromEntries(list.map((x) => [x.id, x.name]));
  const want = list.map((x) => x.id).filter((p) => p !== c.me);
  if (!device) await ensureKeyPackages();
  const claim = async (p: string) => {
    try {
      const r = await api<{
        key_packages: { id: number; device_id: string; key_package: string }[];
      }>('POST', '/mls/keypackages/claim', {
        from_profile_id: c.me,
        to_profile_id: p,
        context: c.ctx,
      });
      return r.key_packages.map((k) => ({ ...k, profile: p }));
    } catch {
      return [];
    }
  };
  const post = (gid: string, envelopes: object[]) =>
    envelopes.length
      ? api('POST', '/mls/messages', {
          from_profile_id: c.me,
          group_id: toB64(fromHex(gid)),
          context: c.ctx,
          envelopes,
        })
      : Promise.resolve();
  if (!c.groups.length) {
    const claimed = (await Promise.all(want.map(claim))).flat();
    if (!claimed.length) {
      await saveConvs();
      return;
    }
    const g = await mls.createWith({ p: c.me, d: device! }, claimed, c.ctx);
    await post(g.groupId, g.envelopes);
    c.groups = [g.groupId];
    await kv.set('g2c:' + g.groupId, c.id);
    await saveConvs();
    return;
  }
  const gid = c.groups[0];
  const state = await mls.load(gid);
  if (!state) return;
  const inGroup = new Set(mls.members(state).map((m) => m.p));
  const gone = [...inGroup].filter((p) => p !== c.me && !want.includes(p));
  if (gone.length) {
    const r = await mls.removeProfiles(gid, gone);
    if (r)
      await post(
        gid,
        r.to
          .filter((m) => !(m.p === c.me && m.d === device))
          .map((m) => ({
            to_profile_id: m.p,
            to_device_id: m.d,
            kind: 'commit',
            ciphertext: toB64(r.commit),
          })),
      );
  }
  const fresh = want.filter((p) => !inGroup.has(p));
  if (fresh.length) {
    const claimed = (await Promise.all(fresh.map(claim))).flat();
    if (claimed.length) {
      const r = await mls.addMembers(gid, claimed, c.ctx);
      const commits = r.before
        .filter((m) => !(m.p === c.me && m.d === device))
        .map((m) => ({
          to_profile_id: m.p,
          to_device_id: m.d,
          kind: 'commit',
          ciphertext: toB64(r.commit),
        }));
      await post(gid, [...commits, ...r.welcomes]);
    }
  }
  await saveConvs();
}

/**
 * R-01.6 device link: add my newly linked device(s) to every chat group this device is in
 * (add commit to the other members, welcome to the new device). New chats include all devices.
 */
export async function addOwnDevices(): Promise<number> {
  if (!device) await ensureKeyPackages();
  let added = 0;
  for (const c of Object.values(convs)) {
    if (c.gone || !c.groups.length) continue;
    const gid = c.groups[0];
    const state = await mls.load(gid);
    if (!state) continue;
    const inGroup = new Set(mls.members(state).map((x) => x.p + '/' + x.d));
    let claimed: { id: number; device_id: string; key_package: string; profile: string }[] = [];
    try {
      const r = await api<{ key_packages: { id: number; device_id: string; key_package: string }[] }>('POST', '/mls/keypackages/claim', { from_profile_id: c.me, to_profile_id: c.me, context: c.ctx });
      claimed = r.key_packages.filter((k) => k.device_id !== device && !inGroup.has(c.me + '/' + k.device_id)).map((k) => ({ ...k, profile: c.me }));
    } catch {
      continue;
    }
    if (!claimed.length) continue;
    const r = await mls.addMembers(gid, claimed, c.ctx);
    const commits = r.before
      .filter((x) => !(x.p === c.me && x.d === device))
      .map((x) => ({ to_profile_id: x.p, to_device_id: x.d, kind: 'commit', ciphertext: toB64(r.commit) }));
    await api('POST', '/mls/messages', { from_profile_id: c.me, group_id: toB64(fromHex(gid)), context: c.ctx, envelopes: [...commits, ...r.welcomes] });
    added++;
  }
  return added;
}

/** Peer name/photo for the inbox (fetched like any profile view; never stored server-side). */
export async function refreshPeer(c: Conv) {
  if (c.ctx) return;
  try {
    const v = await api<ProfileView>('GET', `/profiles/${c.peer}`);
    Object.assign(c, {
      name: v.display_name,
      age: v.age,
      photo: v.photos[0] ?? null,
      verified: v.verified,
      online: !!v.online,
      gone: false,
    });
    people.touchFav(c.peer, { name: v.display_name, photo: v.photos[0] ?? null }).catch(() => {});
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) c.gone = true;
  }
  await saveConvs();
}

/** Opens (or prepares) the conversation between one of my profiles and a peer profile. */
export async function openConv(mine: string, peer: string, hint?: Partial<Conv>): Promise<Conv> {
  const c = await ensureConv(mine, peer);
  if (hint) Object.assign(c, Object.fromEntries(Object.entries(hint).filter(([, v]) => v !== undefined)));
  await saveConvs();
  return c;
}

export async function setConv(id: string, patch: Partial<Pick<Conv, 'starred' | 'muted' | 'archived' | 'receipts' | 'translate'>>) {
  if (!convs[id]) return;
  Object.assign(convs[id], patch);
  await saveConvs();
}

// ------------------------------------------------------------------ friends (R-07.36, #115)

/** Ask the peer of a 1:1 chat to be friends. Visible row in the chat ("Pending" card). */
// #247 R-07.45–R-07.47: friend perks (albums, location) follow the friend state on this phone.
export type FriendChange = (cid: string, peer: string, now: people.FriendState | null, was: people.FriendState | null) => void;
const friendSubs = new Set<FriendChange>();
export function onFriendChange(fn: FriendChange) {
  friendSubs.add(fn);
  return () => {
    friendSubs.delete(fn);
  };
}
async function friendChanged(cid: string, peer: string, was: people.FriendState | null) {
  const now = people.friendOf(peer);
  if (now === was) return;
  if (now === 'yes') await floc.resend().catch(() => {});
  if (was === 'yes') {
    await floc.forget(peer).catch(() => {});
    if (cid && convs[cid] && (await floc.mine())) await send(cid, { t: 'friend.loc', stop: true }, { silent: true }).catch(() => {});
  }
  friendSubs.forEach((f) => {
    try {
      f(cid, peer, now, was);
    } catch {
      /* a perk failing never blocks the chat */
    }
  });
}
async function friendOp(c: Conv, op: people.FriendOp, mine: boolean) {
  const was = people.friendOf(c.peer);
  const show = await people.applyFriend(c.peer, op, mine);
  await friendChanged(c.id, c.peer, was);
  return show;
}
/** #247 R-07.46: make a friend a trusted contact; the invite link travels E2EE in this chat. */
export async function sendSafetyInvite(cid: string, url: string) {
  const c = convs[cid];
  if (!c || c.ctx || people.friendOf(c.peer) !== 'yes') return;
  await send(cid, { t: 'safety.invite', url });
}

/** #247 R-07.49: invite friends (1:1 chats) to my party. Returns how many were sent. */
export async function sendPartyInvites(peers: string[], party: { id: string; code?: string | null; title: string; starts_at: string }) {
  let n = 0;
  for (const peer of peers) {
    const c = convWith(peer);
    if (!c || people.friendOf(peer) !== 'yes') continue;
    await send(c.id, { t: 'party.invite', party: party.id, ...(party.code ? { code: party.code } : {}), title: party.title.slice(0, 80), starts_at: party.starts_at })
      .then(() => n++)
      .catch(() => {});
  }
  return n;
}

/** #247 R-07.47: send my spot to every friend if due (start, every 10 min, or after 200 m). */
export async function shareLocTick(here: { lat: number; lng: number } | null, force = false) {
  const m = await floc.mine();
  if (!here || !m || m.until <= Date.now()) return;
  if (!force && !floc.due(m, here)) return;
  const spot = { lat: floc.round(here.lat), lng: floc.round(here.lng) };
  for (const peer of people.friendList('yes')) {
    const c = convWith(peer);
    if (c) await send(c.id, { t: 'friend.loc', ...spot, until: m.until }, { silent: true }).catch(() => {});
  }
  await floc.markSent(spot);
}

/** Stop sharing: friends forget my spot at once. */
export async function stopLocShare() {
  const m = await floc.mine();
  await floc.stop();
  if (!m) return;
  for (const peer of people.friendList('yes')) {
    const c = convWith(peer);
    if (c) await send(c.id, { t: 'friend.loc', stop: true }, { silent: true }).catch(() => {});
  }
}

/** Block / report (R-07.38): forget the friendship and let perks revoke what they gave. */
export async function forgetFriend(peer: string) {
  const was = people.friendOf(peer);
  await people.forgetFriend(peer);
  await friendChanged(convWith(peer)?.id ?? '', peer, was);
}

export async function requestFriend(cid: string) {
  const c = convs[cid];
  if (!c || c.ctx || !c.peer) return;
  const cur = people.friendOf(c.peer);
  if (cur === 'in') return answerFriend(cid, true);
  if (!people.canAsk(c.peer)) return;
  await friendOp(c, 'request', true);
  await send(cid, { t: 'friend', op: 'request' });
}

/** Accept (visible "You are friends" row) or Not now (quiet `decline`). */
export async function answerFriend(cid: string, accept: boolean) {
  const c = convs[cid];
  if (!c || c.ctx || !c.peer || people.friendOf(c.peer) !== 'in') return;
  await friendOp(c, accept ? 'accept' : 'decline', true);
  await send(cid, { t: 'friend', op: accept ? 'accept' : 'decline' }, { silent: !accept });
}

/** Cancel my pending request, or remove a friend. Both quiet on the other side. */
export async function dropFriend(cid: string) {
  const c = convs[cid];
  if (!c || c.ctx || !c.peer) return;
  const cur = people.friendOf(c.peer);
  if (!cur) return;
  const op = cur === 'out' ? 'cancel' : cur === 'in' ? 'decline' : 'remove';
  await friendOp(c, op, true);
  await send(cid, { t: 'friend', op }, { silent: true });
}

// ------------------------------------------------------------------ video check (F-18 R-18.7–R-18.18, #159)

const VC_QUIET: vc.VcOp[] = ['decline', 'cancel', 'done'];

/** Applies a video check payload on this phone, then sends it E2EE to the peer. */
export async function sendVc(cid: string, p: Omit<vc.VcPayload, 't'>) {
  const c = convs[cid];
  if (!c || c.ctx || !c.peer) return;
  const body: vc.VcPayload = { t: 'vcheck', ...p };
  const show = await vc.apply(c.peer, body, true);
  await send(cid, body, { silent: !show || VC_QUIET.includes(p.op) });
}

/** The 1:1 chat with a peer, if any. */
export const convWith = (peer: string) => Object.values(convs).find((c) => !c.ctx && c.peer === peer) ?? null;

/** Delete locally (R-07.8): messages, group state and the inbox row. */
export async function deleteConv(id: string) {
  const c = convs[id];
  if (!c) return;
  for (const g of c.groups) {
    await mls.forget(g);
    await kv.del('g2c:' + g);
  }
  await store.lock('c:' + id, () => store.drop(id));
  for (const it of await items()) if (it.cid === id) await delItem(it);
  delete convs[id];
  await saveConvs();
}

// ------------------------------------------------------------------ send

export { firstMessageProblem } from './rules';

async function ensureGroup(c: Conv): Promise<string> {
  if (c.groups.length) return c.groups[0];
  const claimed = await api<{
    key_packages: { id: number; device_id: string; key_package: string }[];
  }>('POST', '/mls/keypackages/claim', {
    from_profile_id: c.me,
    to_profile_id: c.peer,
  });
  if (!device) await ensureKeyPackages();
  const g = await mls.createWith(
    { p: c.me, d: device! },
    claimed.key_packages.map((k) => ({ ...k, profile: c.peer })),
  );
  await api('POST', '/mls/messages', {
    from_profile_id: c.me,
    group_id: toB64(g.gid),
    envelopes: g.envelopes,
  });
  c.groups = [g.groupId, ...c.groups].sort();
  await kv.set('g2c:' + g.groupId, c.id);
  await saveConvs();
  return c.groups[0];
}

/**
 * Sends a payload through the outbox (R-07.17). Visible payloads are added to the thread
 * optimistically (R-07.14). Resolves once the first attempt is done; offline it stays
 * "Sending" and is retried automatically. Throws only errors a retry can't fix.
 */
export async function send(cid: string, p: Payload, opts: { silent?: boolean } = {}): Promise<Msg | null> {
  const c = convs[cid];
  if (!c) throw new Error('no conversation');
  const id = hex(rand(12));
  const at = Date.now();
  const fk = rand(32);
  const n = c.ctx ? (me?.profiles ?? []).find((x) => x.id === c.me)?.display_name : undefined;
  const body: Wire = { ...(p as object), v: 1, id, at, fk: toB64(fk), ...(c.ctx ? { n, g: c.name } : {}) } as Wire;
  const plain = utf8(JSON.stringify(body));
  // R-07.11 franking: commitment over the plaintext, opened only if the recipient reports.
  const tag = hmac(sha256, fk, plain);
  let msg: Msg | null = null;
  if (!opts.silent) {
    msg = { id, from: 'me', at, p, status: 'sending', fk: toB64(fk) };
    const m = msg;
    await edit(cid, () => ({ put: [m] }));
    c.lastAt = at;
    c.last = preview(p);
    c.iWrote = true;
    if (p.t === 'disappearing') c.ttl = p.ttl;
    await saveConvs();
  }
  // Written before any network call: survives kill, reboot and token refresh. FIFO by `created`.
  lastCreated ||= Math.max(0, ...(await items()).map((i) => i.created));
  lastCreated = Math.max(Date.now(), lastCreated + 1);
  await putItem({ id, cid, t: p.t, plain: toB64(plain), tag: toB64(tag), visible: !opts.silent, created: lastCreated, tries: 0, next: 0 });
  const r = await drainConv(cid, id);
  if (r instanceof Error) throw r;
  return msg;
}

// ------------------------------------------------------------------ outbox (R-07.17–R-07.19)

type Item = {
  /** Payload id = `client_id` (R-07.18). */
  id: string;
  cid: string;
  t: Payload['t'];
  plain: string;
  tag: string;
  visible: boolean;
  created: number;
  tries: number;
  next: number;
  /** Gave up after 24 h: shown as Not sent, waits for Retry. */
  dead?: boolean;
  /** #206: the 1:1 group was rebuilt once for a stale device. */
  rebuilt?: boolean;
  /** Sealed once; retries resend the same ciphertext (never re-encrypt). */
  sealed?: { gid: string; wire: string; to: mls.Member[] };
};

const OUTBOX_GIVE_UP = 24 * 3600_000;
const SEND_TIMEOUT = 15_000;
const itemKey = (it: Item) => `ob:${String(it.created).padStart(15, '0')}:${it.id}`;
const putItem = (it: Item) => kv.set(itemKey(it), it);
const delItem = (it: Item) => kv.del(itemKey(it));
const items = async () => (await kv.getPrefix<Item>('ob:')).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
const isReceipt = (t: Payload['t']) => t === 'read' || t === 'delivered';

/** Errors a retry can't fix (R-07.17). Everything else (offline, timeout, 5xx, 429) is retried. */
const permanent = (e: unknown) => e instanceof ApiError && [400, 403, 404, 422].includes(e.status);
/** 422 `to_device_id: unknown device`: a member device of the group was deleted on the server. */
export const staleDevice = (e: unknown) => e instanceof ApiError && e.status === 422 && !!e.fields?.to_device_id;

/** 1 s, 2 s, 4 s … capped at 60 s, ± 20 % jitter. */
export const backoff = (tries: number, rnd = Math.random()) => Math.min(60_000, 1000 * 2 ** Math.max(0, tries - 1)) * (0.8 + 0.4 * rnd);

let drainTimer: ReturnType<typeof setTimeout> | null = null;
let lastCreated = 0;

/**
 * Drains every conversation's queue (FIFO per chat; one chat never blocks another).
 * `now`: a sign the network is back (launch, reconnect, foreground, push) → skip the backoff wait.
 */
export async function drain(now = true) {
  if (!me) return;
  const cids = [...new Set((await items()).filter((i) => !i.dead).map((i) => i.cid))];
  await Promise.all(cids.map((cid) => drainConv(cid, undefined, now)));
}

/** Sends this chat's queue in order. `want` = item the caller waits for (tries now, no backoff). */
function drainConv(cid: string, want?: string, now = !!want): Promise<unknown> {
  return store.lock('ob:' + cid, async () => {
    let result: unknown;
    for (const it of (await items()).filter((i) => i.cid === cid && !i.dead)) {
      if (!now && it.next > Date.now()) break;
      const r = await attempt(it);
      if (it.id === want) result = r;
      if (r === 'retry') break;
    }
    schedule();
    return result;
  });
}

function schedule() {
  if (!me) return;
  items()
    .then((list) => {
      const next = Math.min(...list.filter((i) => !i.dead).map((i) => i.next));
      if (drainTimer) clearTimeout(drainTimer);
      if (!me) return;
      drainTimer = Number.isFinite(next) ? setTimeout(() => drain(false).catch(() => {}), Math.max(250, next - Date.now())) : null;
    })
    .catch(() => {});
}

async function attempt(it: Item): Promise<'ok' | 'retry' | Error> {
  const c = convs[it.cid];
  if (!c || !me) {
    if (!c) await delItem(it);
    return 'ok';
  }
  try {
    // #206: sealed into a 1:1 group that was since dropped (stale device rebuild) → seal again.
    if (it.sealed && !c.ctx && !c.groups.includes(it.sealed.gid)) it.sealed = undefined;
    if (!it.sealed) {
      if (c.ctx && !c.groups.length) throw new Error('group_pending');
      const gid = await ensureGroup(c);
      const sealed = await mls.seal(gid, fromB64(it.plain));
      it.sealed = { gid, wire: toB64(sealed.wire), to: sealed.members.filter((m) => !(m.p === c.me && m.d === device)) };
      await putItem(it);
    }
    const { gid, wire, to } = it.sealed;
    const r = to.length
      ? await api<{ delivered: string[]; undelivered: string[] }>(
          'POST',
          '/mls/messages',
          {
            client_id: it.id,
            from_profile_id: c.me,
            group_id: toB64(fromHex(gid)),
            franking_tag: it.tag,
            context: c.ctx,
            envelopes: to.map((m) => ({ to_profile_id: m.p, to_device_id: m.d, kind: 'app', ciphertext: wire })),
          },
          true,
          SEND_TIMEOUT,
        )
      : { delivered: [], undelivered: [] };
    await delItem(it);
    if (it.visible) await setStatus(it.cid, it.id, r.undelivered.length ? 'failed' : 'sent');
    if (it.t !== 'profile.private' && !isReceipt(it.t) && it.t !== 'resync') sharePrivate(c).catch(() => {});
    return 'ok';
  } catch (e) {
    // #206 (R-07.20): a device in the 1:1 group no longer exists (the other person reinstalled,
    // signed out, or a test bot restarted). Rebuild the group with their current devices once
    // and send again, instead of showing "Not sent".
    if (staleDevice(e) && it.sealed && !c.ctx && !it.rebuilt) {
      const bad = it.sealed.gid;
      it.sealed = undefined;
      it.rebuilt = true;
      await putItem(it);
      await dropGroup(c.id, bad);
      return attempt(it);
    }
    if (permanent(e)) {
      await delItem(it);
      if (it.visible) await setStatus(it.cid, it.id, 'failed');
      return e as Error;
    }
    it.tries += 1;
    if (Date.now() - it.created > OUTBOX_GIVE_UP) {
      if (!it.visible) await delItem(it);
      else {
        it.dead = true;
        await putItem(it);
        await setStatus(it.cid, it.id, 'failed');
      }
      return 'ok'; // no longer blocks the chat's queue
    }
    it.next = Date.now() + backoff(it.tries);
    await putItem(it);
    return 'retry';
  }
}

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function setStatus(cid: string, id: string, status: NonNullable<Msg['status']>) {
  await edit(cid, (list) => {
    const m = list.find((x) => x.id === id);
    if (!m) return;
    const next = up(m.status, status);
    if (next !== m.status) return { put: [{ ...m, status: next }] };
  });
}

/** Retry on a "Not sent" message: same id and ciphertext if it is still in the outbox. */
export async function retry(cid: string, id: string) {
  const it = (await items()).find((i) => i.id === id && i.cid === cid);
  if (it) {
    await delItem(it);
    lastCreated = Math.max(Date.now(), lastCreated + 1);
    Object.assign(it, { dead: false, tries: 0, next: 0, created: lastCreated });
    await putItem(it);
    await edit(cid, (list) => {
      const m = list.find((x) => x.id === id);
      if (m) return { put: [{ ...m, status: 'sending' }] };
    });
    const r = await drainConv(cid, id);
    if (r instanceof Error) throw r;
    return;
  }
  // Rejected by the server (blocked, not verified…): send again as a new message.
  const m = (await messages(cid)).find((x) => x.id === id);
  if (!m) return;
  await edit(cid, () => ({ del: [id] }));
  await send(cid, m.p);
}

/** Opening a thread: clear unread; send a read receipt if both sides allow (R-07.7, R-07.23). */
export async function markRead(cid: string) {
  const c = convs[cid];
  if (!c) return;
  const now = Date.now();
  let last: Msg | null = null;
  await edit(cid, (list) => {
    const out: Msg[] = [];
    for (const m of list) {
      if (m.from !== 'them' || m.p.t === 'notice') continue;
      last = m;
      if (!m.readAt) out.push({ ...m, readAt: now });
    }
    return { put: out };
  });
  if (c.unread) {
    c.unread = 0;
    await saveConvs();
  }
  const l = last as Msg | null;
  if (l && receiptsOn(c) && !(await kv.get<boolean>('read:' + l.id))) {
    await kv.set('read:' + l.id, true);
    send(cid, { t: 'read', upTo: l.id }, { silent: true }).catch(() => {});
  }
}

let lastTyping = 0;
export function sendTyping(cid: string) {
  const c = convs[cid];
  if (!c || c.ctx || !chan || !receiptsOn(c) || Date.now() - lastTyping < 3000) return;
  lastTyping = Date.now();
  chan.push('typing', { from_profile_id: c.me, to_profile_id: c.peer });
}

// ------------------------------------------------------------------ disappearing (R-07.6)

export function expiresAt(c: Conv, m: Msg): number | null {
  const ttl = TTL_S[c.ttl];
  if (!ttl || m.p.t === 'disappearing') return null;
  const start = m.readAt ?? (m.from === 'me' ? m.at : null);
  return start ? start + ttl * 1000 : null;
}

async function sweepExpired() {
  const now = Date.now();
  for (const c of Object.values(convs)) {
    if (!TTL_S[c.ttl]) continue;
    await edit(c.id, (list) => ({
      del: list
        .filter((m) => {
          const e = expiresAt(c, m);
          return e && e <= now;
        })
        .map((m) => m.id),
    }));
  }
}

// ------------------------------------------------------------------ local wipe of one message (view-once)

export async function markOpened(cid: string, id: string) {
  await edit(cid, (list) => {
    const m = list.find((x) => x.id === id);
    if (m) return { put: [{ ...m, opened: true }] };
  });
}

/** Delete one message on this device only (S-41 long-press › Delete for me). */
export async function deleteMessage(cid: string, id: string) {
  await edit(cid, (list) => ({ del: list.filter((x) => x.id === id || (x.p.t === 'reaction' && x.p.to === id)).map((x) => x.id) }));
}

// R-06.6: fields set to "My chats" are sent E2EE to chat partners when a chat starts or they change.
async function chatFields(profileId: string): Promise<Record<string, unknown>> {
  const vis = (me?.profiles ?? []).find((x) => x.id === profileId)?.visibility_map ?? {};
  const local = await getLocal(profileId);
  return Object.fromEntries(Object.entries(local).filter(([k, v]) => vis[k] === 'chats' && v !== null && v !== '' && v !== undefined));
}

async function sharePrivate(c: Conv) {
  if (c.ctx) return; // never to group chats
  const fields = await chatFields(c.me);
  const sig = hex(sha256(utf8(JSON.stringify(fields))));
  if (c.privSent === sig || (!Object.keys(fields).length && !c.privSent)) return;
  c.privSent = sig;
  await saveConvs();
  await send(c.id, { t: 'profile.private', fields }, { silent: true });
}

/** After editing "My chats" fields: resend to every conversation of that profile. */
export async function resharePrivate(profileId: string) {
  for (const c of Object.values(convs)) if (c.me === profileId && c.groups.length && !c.gone) await sharePrivate(c).catch(() => {});
}

/** Keeps settings (read receipts, disappearing default) in sync with the session. */
export const updateMe = (m: Me) => {
  if (me) me = m;
};

export const currentDevice = () => device;
export const currentMe = () => me;

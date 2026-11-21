// #247 R-07.47 (F-05 R-05.x): "Show me to friends" for 1 h / 6 h / 24 h, at any location level
// (made for Hidden). The spot (about 100 m) goes E2EE to each accepted friend in the 1:1 chat as a
// silent `friend.loc`; the server only relays ciphertext and never learns the place or the friendship.
import { useEffect, useReducer } from 'react';
import { kv } from './kv';
import * as People from './people';

export type FriendLoc = { t: 'friend.loc'; lat?: number; lng?: number; until?: number; stop?: boolean };
export type Seen = { lat: number; lng: number; until: number; at: number };
export type Mine = { until: number; sent?: { lat: number; lng: number; at: number } };

export const HOURS = [1, 6, 24] as const;
/** Resend while the app is open. */
export const EVERY_MS = 10 * 60_000;
/** Resend after moving this far. */
export const MOVE_M = 200;
/** A friend's spot older than this is not drawn (he closed the app). */
export const STALE_MS = 30 * 60_000;
const MAX_HOURS = 24;

const K_MINE = 'floc.mine';
const kSeen = (peer: string) => `floc:${peer}`;

/** About 100 m: three decimals (≈ 111 m north–south). */
export const round = (x: number) => Math.round(x * 1000) / 1000;

export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** Pure: should we send now? */
export function due(mine: Mine | null, here: { lat: number; lng: number } | null, now = Date.now()): boolean {
  if (!mine || mine.until <= now || !here) return false;
  if (!mine.sent) return true;
  return now - mine.sent.at >= EVERY_MS || metres(mine.sent, here) >= MOVE_M;
}

/** Pure: is a received spot still drawn? */
export const visible = (s: Seen | null, now = Date.now()) => !!s && s.until > now && now - s.at < STALE_MS;

/** Pure: validate a received payload into what we store (null = forget). */
export function accept(p: FriendLoc, now = Date.now()): Seen | null {
  if (p.stop) return null;
  const { lat, lng, until } = p;
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof until !== 'number') return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || until <= now) return null;
  return { lat: round(lat), lng: round(lng), until: Math.min(until, now + MAX_HOURS * 3600_000), at: now };
}

// ------------------------------------------------------------------ state

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let seen: Record<string, Seen> = {};
let loaded = false;

async function load() {
  if (loaded) return;
  loaded = true;
  await People.loadPeople();
  const next: Record<string, Seen> = {};
  for (const peer of People.friendList('yes')) {
    const s = await kv.get<Seen>(kSeen(peer));
    if (s) next[peer] = s;
  }
  seen = next;
  emit();
}

export const mine = () => kv.get<Mine>(K_MINE);

/** Received from a friend (only accepted friends are kept). */
export async function receive(peer: string, p: FriendLoc) {
  const s = People.friendOf(peer) === 'yes' ? accept(p) : null;
  if (s) {
    seen = { ...seen, [peer]: s };
    await kv.set(kSeen(peer), s);
  } else {
    const { [peer]: _gone, ...rest } = seen;
    seen = rest;
    await kv.del(kSeen(peer));
  }
  emit();
}

export async function forget(peer: string) {
  await receive(peer, { t: 'friend.loc', stop: true });
}

/** Friends whose spot is drawn now. */
export function shown(now = Date.now()): ({ peer: string } & Seen)[] {
  return Object.entries(seen)
    .filter(([peer, s]) => visible(s, now) && People.friendOf(peer) === 'yes')
    .map(([peer, s]) => ({ peer, ...s }));
}

export function useFriendLocs() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    load();
    subs.add(bump);
    const t = setInterval(bump, 60_000);
    return () => {
      subs.delete(bump);
      clearInterval(t);
    };
  }, []);
  return shown();
}

export function onMine(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Starts (or extends) sharing; `send` is injected by the engine side to avoid a cycle. */
export async function start(hours: number) {
  const h = Math.max(1, Math.min(MAX_HOURS, hours));
  await kv.set(K_MINE, { until: Date.now() + h * 3600_000 });
  emit();
}

export async function stop() {
  await kv.del(K_MINE);
  emit();
}

export async function markSent(p: { lat: number; lng: number }) {
  const m = await mine();
  if (m) await kv.set(K_MINE, { ...m, sent: { ...p, at: Date.now() } });
}

/** A new friend should get my spot at the next tick. */
export async function resend() {
  const m = await mine();
  if (m?.sent) await kv.set(K_MINE, { until: m.until });
}

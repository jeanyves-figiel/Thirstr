// F-18 R-18.7–R-18.18 (#159): video check of a chat partner. Device-only state (encrypted store);
// requests, clips (blob id + key) and answers travel as E2EE `vcheck` payloads inside the 1:1 chat.
// The server only ever sees a one-time ciphertext blob (R-18.12).
import { useEffect, useReducer } from 'react';
import { api } from '../api/client';
import { kv } from './kv';
import { rand } from './bytes';

export type VcOp = 'request' | 'decline' | 'cancel' | 'clip' | 'done' | 'confirm' | 'screenshot';
export type Clip = { blob: string; key: string; iv: string; dur: number };
export type VcPayload = {
  t: 'vcheck';
  op: VcOp;
  rid: string;
  move?: number;
  mutual?: boolean;
  exp?: number;
  clip?: Clip;
  /** "Send mine too": a clip nobody asked for, attached to the sender's own request. */
  offer?: boolean;
};

/** out = I watch (I asked, or got an offer) · in = I record. */
export type VcState = 'requested' | 'declined' | 'cancelled' | 'recorded' | 'watched' | 'confirmed' | 'rejected';
export type Vc = { rid: string; peer: string; dir: 'out' | 'in'; move: number; mutual: boolean; exp: number; state: VcState; at: number; clip?: Clip; shot?: boolean };
export type Badge = { at: number };

export const TTL_MS = 24 * 3600_000;
export const BADGE_MS = 90 * 24 * 3600_000;
export const PER_DAY = 3;
export const ASK_AGAIN_MS = 3600_000;
export const MIN_S = 3;
export const MAX_S = 5;
export const MAX_BYTES = 3 * 1024 * 1024;

/** 8 hand signs × 6 face moves = 48 two-step moves (R-18.8). Index = hand * 6 + face. */
export const HANDS = ['✌️', '👍', '🖐️', '☝️', '🤙', '👌', '🤘', '👋'] as const;
export const FACES = ['👂', '👃', '😉', '⬅️', '➡️', '😮'] as const;
export const MOVES = HANDS.length * FACES.length;
export const moveParts = (i: number) => ({ hand: Math.floor(i / FACES.length) % HANDS.length, face: i % FACES.length });
export const moveEmoji = (i: number) => {
  const { hand, face } = moveParts(i);
  return HANDS[hand] + FACES[face];
};
/** CSPRNG, never the same as `not` (⟳ Another). */
export function drawMove(not?: number): number {
  for (;;) {
    const b = rand(2);
    const v = ((b[0] << 8) | b[1]) % MOVES;
    if (v !== not) return v;
  }
}

let all: Record<string, Vc> = {};
let badges: Record<string, Badge> = {};
let loaded: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function loadVc(): Promise<void> {
  loaded ??= (async () => {
    all = (await kv.get<Record<string, Vc>>('vchecks')) ?? {};
    badges = (await kv.get<Record<string, Badge>>('vbadges')) ?? {};
    emit();
  })().catch(() => {
    loaded = null;
  });
  return loaded ?? Promise.resolve();
}

export function resetVc() {
  all = {};
  badges = {};
  loaded = null;
  emit();
}

async function save() {
  await kv.set('vchecks', all);
  await kv.set('vbadges', badges);
  emit();
}

export const get = (rid: string) => all[rid];
/** R-18.18: only requested / recorded expire. */
export function effective(v: Vc | undefined, now = Date.now()): VcState | 'expired' | undefined {
  if (!v) return undefined;
  if ((v.state === 'requested' || v.state === 'recorded') && now > v.exp) return 'expired';
  return v.state;
}
const open = (v: Vc, now: number) => {
  const s = effective(v, now);
  return s === 'requested' || s === 'recorded';
};
const ofPeer = (peer: string) => Object.values(all).filter((v) => v.peer === peer);

/** R-18.7: one open check per chat (either way), 3 asks per chat per 24 h, 1 h after a decline. */
export type AskBlock = 'open' | 'declined' | 'limit';
/** Why a new ask isn't possible right now (null = it is). The chat ⋯ row stays visible and says so (#159 regression). */
export function askBlock(peer: string, now = Date.now()): AskBlock | null {
  const list = ofPeer(peer);
  if (list.some((v) => open(v, now))) return 'open';
  const mine = list.filter((v) => v.dir === 'out' && !v.rid.endsWith('m'));
  if (mine.filter((v) => now - v.at < 24 * 3600_000).length >= PER_DAY) return 'limit';
  const lastDecline = mine.filter((v) => v.state === 'declined').sort((a, b) => b.at - a.at)[0];
  return lastDecline && now - lastDecline.at < ASK_AGAIN_MS ? 'declined' : null;
}
export const canAsk = (peer: string, now = Date.now()) => askBlock(peer, now) === null;
/** Chat ⋯ lists "Video check ‹name›" in every 1:1 chat on a supported phone unless the server kill switch (`video_check`) is off. */
export const menuShown = (o: { available: boolean; on: boolean; group: boolean }) => o.available && o.on && !o.group;

export const openFor = (peer: string, now = Date.now()) => ofPeer(peer).find((v) => open(v, now));

/** Video-checked badge (R-18.17): per person, device-only, 90 days. */
export function badgeOf(peer: string, now = Date.now()): { at: number; fresh: boolean; months: number } | null {
  const b = badges[peer];
  return b ? { at: b.at, fresh: now - b.at < BADGE_MS, months: Math.max(1, Math.round((now - b.at) / (30 * 24 * 3600_000))) } : null;
}

export const newRid = () => Array.from(rand(12), (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Applies a `vcheck` payload (sent by me or received). Returns true when it shows as a row in the chat.
 * Quiet: decline, cancel, done, and requests over the limits (R-18.7).
 */
export async function apply(peer: string, p: VcPayload, mine: boolean, now = Date.now()): Promise<boolean> {
  await loadVc();
  const cur = all[p.rid];
  switch (p.op) {
    case 'request': {
      if (cur) return false;
      if (!mine) {
        const list = ofPeer(peer);
        const recent = list.filter((v) => v.dir === 'in' && now - v.at < 24 * 3600_000).length;
        if (recent >= PER_DAY || list.some((v) => open(v, now))) return false;
      }
      const exp = Math.min(p.exp ?? now + TTL_MS, now + TTL_MS);
      all = { ...all, [p.rid]: { rid: p.rid, peer, dir: mine ? 'out' : 'in', move: (p.move ?? 0) % MOVES, mutual: !!p.mutual, exp, state: 'requested', at: now } };
      await save();
      return true;
    }
    case 'clip': {
      if (!p.clip) return false;
      if (p.offer) {
        // Mutual: the requester sends their own clip; the receiver watches it.
        if (cur) return false;
        all = { ...all, [p.rid]: { rid: p.rid, peer, dir: mine ? 'in' : 'out', move: (p.move ?? 0) % MOVES, mutual: true, exp: now + TTL_MS, state: 'recorded', at: now, clip: mine ? undefined : p.clip } };
        await save();
        return true;
      }
      if (!cur || effective(cur, now) !== 'requested') return false;
      if (mine ? cur.dir !== 'in' : cur.dir !== 'out') return false;
      all = { ...all, [p.rid]: { ...cur, state: 'recorded', exp: now + TTL_MS, clip: mine ? undefined : p.clip } };
      await save();
      return true;
    }
    case 'decline':
    case 'cancel': {
      if (!cur || cur.state !== 'requested') return false;
      all = { ...all, [p.rid]: { ...cur, state: p.op === 'decline' ? 'declined' : 'cancelled', at: p.op === 'decline' && cur.dir === 'out' ? now : cur.at } };
      await save();
      return false;
    }
    case 'done': {
      if (!cur || (cur.state !== 'recorded' && cur.state !== 'watched')) return false;
      all = { ...all, [p.rid]: { ...cur, state: cur.state === 'recorded' ? 'watched' : cur.state, clip: undefined } };
      await save();
      return false;
    }
    case 'confirm': {
      if (!cur) return false;
      all = { ...all, [p.rid]: { ...cur, state: 'confirmed', clip: undefined } };
      // Only the watcher gets the badge (R-18.16); the recorder sees the system line.
      if (cur.dir === 'out') badges = { ...badges, [peer]: { at: now } };
      await save();
      return true;
    }
    case 'screenshot': {
      if (!cur) return false;
      all = { ...all, [p.rid]: { ...cur, shot: true } };
      await save();
      return !mine;
    }
  }
  return false;
}

/** Local transitions that send nothing to the other side. */
export async function mark(rid: string, state: VcState) {
  const cur = all[rid];
  if (!cur) return;
  all = { ...all, [rid]: { ...cur, state, clip: state === 'recorded' ? cur.clip : undefined } };
  await save();
}

/** Block / report-and-block / profile gone: drop everything about this person, nothing is sent (R-18.7). */
export async function forgetVc(peer: string) {
  await loadVc();
  const mine = ofPeer(peer);
  if (!mine.length && !badges[peer]) return;
  const next = { ...all };
  for (const v of mine) delete next[v.rid];
  all = next;
  const { [peer]: _gone, ...rest } = badges;
  badges = rest;
  await save();
}

/** Recorder deletes its own unwatched blob early (cancel, block). Best effort: the server sweeps at 24 h anyway. */
export const dropBlob = (blob: string) => api('DELETE', `/media/${blob}`).catch(() => {});

/** Device-only part of "Download my data". */
export const exportVc = () => ({ badges: { ...badges } });

export function useVc() {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    loadVc();
    subs.add(bump);
    return () => {
      subs.delete(bump);
    };
  }, []);
  return tick;
}

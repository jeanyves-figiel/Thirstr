// F-07 R-07.32–R-07.38 (#115): favorites, private notes and friends. Device-only (encrypted store),
// never sent to the server. Friend requests travel as E2EE `friend` payloads inside the 1:1 chat (engine.ts).
import { useEffect, useReducer } from 'react';
import { kv } from './kv';

export type Note = { text: string; tags: string[] };
export type Fav = { at: number; name?: string; photo?: string | null };
/** out = I asked (pending) · in = they asked · yes = friends. Absent = not friends. */
export type FriendState = 'out' | 'in' | 'yes';
export type FriendOp = 'request' | 'accept' | 'decline' | 'cancel' | 'remove';

/** R-07.36: after "Not now" the asker may ask again only after 7 days (enforced on the asker's device). */
export const ASK_AGAIN_MS = 7 * 24 * 3600_000;
export const NOTE_MAX = 500;
export const TAGS_MAX = 10;

let favs: Record<string, Fav> = {};
let friends: Record<string, FriendState> = {};
let declined: Record<string, number> = {};
let notes: Record<string, Note> = {};
let loaded: Promise<void> | null = null;

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function onPeople(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Loads the device store once per sign-in (engine.start). */
export function loadPeople(): Promise<void> {
  loaded ??= (async () => {
    favs = (await kv.get<Record<string, Fav>>('favs')) ?? {};
    friends = (await kv.get<Record<string, FriendState>>('friends')) ?? {};
    declined = (await kv.get<Record<string, number>>('friends.declined')) ?? {};
    const out: Record<string, Note> = {};
    for (const k of await kv.keys('note:')) {
      const n = await kv.get<Note>(k);
      if (n && (n.text || n.tags?.length)) out[k.slice(5)] = { text: n.text ?? '', tags: n.tags ?? [] };
    }
    notes = out;
    emit();
  })().catch(() => {
    loaded = null;
  });
  return loaded ?? Promise.resolve();
}

export function resetPeople() {
  favs = {};
  friends = {};
  declined = {};
  notes = {};
  loaded = null;
  emit();
}

// ------------------------------------------------------------------ favorites (R-07.32)

export const isFav = (peer: string) => !!favs[peer];
/** Most recent first. */
export const favList = () =>
  Object.entries(favs)
    .map(([peer, f]) => ({ peer, ...f }))
    .sort((a, b) => b.at - a.at);

export async function setFav(peer: string, on: boolean, snap?: { name?: string; photo?: string | null }) {
  if (!peer) return;
  if (on) favs = { ...favs, [peer]: { ...favs[peer], ...snap, at: favs[peer]?.at ?? Date.now() } };
  else {
    const { [peer]: _gone, ...rest } = favs;
    favs = rest;
  }
  await kv.set('favs', favs);
  emit();
}

/** Keeps the name/photo snapshot fresh so a favorite without a chat still shows nicely. */
export async function touchFav(peer: string, snap: { name?: string; photo?: string | null }) {
  const f = favs[peer];
  if (!f || (f.name === snap.name && f.photo === snap.photo)) return;
  favs = { ...favs, [peer]: { ...f, ...snap } };
  await kv.set('favs', favs);
  emit();
}

// ------------------------------------------------------------------ notes (R-06.9, R-07.35)

export const noteFor = (peer: string): Note | null => notes[peer] ?? null;

export async function setNote(peer: string, n: Note) {
  const clean: Note = {
    text: n.text.trim().slice(0, NOTE_MAX),
    tags: [...new Set(n.tags.map((t) => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, TAGS_MAX).map((t) => t.slice(0, 30)),
  };
  if (clean.text || clean.tags.length) {
    notes = { ...notes, [peer]: clean };
    await kv.set('note:' + peer, clean);
  } else {
    const { [peer]: _gone, ...rest } = notes;
    notes = rest;
    await kv.del('note:' + peer);
  }
  emit();
  return clean;
}

/** All tags I used, most used first (suggestions in the note sheet). */
export function myTags(): { tag: string; n: number }[] {
  const count: Record<string, number> = {};
  for (const n of Object.values(notes)) for (const t of n.tags) count[t] = (count[t] ?? 0) + 1;
  return Object.entries(count)
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/** One line for inbox rows: tags first, else the note text. */
export function noteLine(peer: string): string {
  const n = notes[peer];
  if (!n) return '';
  return n.tags.length ? n.tags.join(' · ') : n.text.replace(/\s+/g, ' ');
}

/** R-07.34: device-only search over name, last message and my note. */
export function matches(q: string, peer: string, ...fields: (string | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const n = notes[peer];
  const hay = [...fields, n?.text, ...(n?.tags ?? [])].filter(Boolean).join('\n').toLowerCase();
  return hay.includes(needle);
}

// ------------------------------------------------------------------ friends (R-07.36)

export const friendOf = (peer: string): FriendState | null => friends[peer] ?? null;
export const friendList = (s: FriendState) => Object.keys(friends).filter((p) => friends[p] === s);

/** May I send a request now? (not already pending/friends, 7-day pause after "Not now"). */
export function canAsk(peer: string, now = Date.now()): boolean {
  if (friends[peer]) return false;
  return !declined[peer] || now - declined[peer] >= ASK_AGAIN_MS;
}

async function save() {
  await kv.set('friends', friends);
  await kv.set('friends.declined', declined);
  emit();
}

async function put(peer: string, s: FriendState | null) {
  if (s) friends = { ...friends, [peer]: s };
  else {
    const { [peer]: _gone, ...rest } = friends;
    friends = rest;
  }
  await save();
}

/**
 * State change for one friend op. `mine` = sent by me (this or my other device).
 * Returns whether the op shows as a row in the chat (request and accept do; the rest are quiet).
 */
export async function applyFriend(peer: string, op: FriendOp, mine: boolean): Promise<boolean> {
  const cur = friends[peer] ?? null;
  switch (op) {
    case 'request':
      if (mine) {
        await put(peer, cur === 'in' ? 'yes' : cur === 'yes' ? 'yes' : 'out');
        return true;
      }
      // Both asked at once → friends.
      if (cur === 'yes') return false;
      await put(peer, cur === 'out' ? 'yes' : 'in');
      return true;
    case 'accept':
      if (mine) {
        if (cur !== 'in' && cur !== 'yes') return false;
        await put(peer, 'yes');
        return true;
      }
      if (cur !== 'out' && cur !== 'yes') return false;
      await put(peer, 'yes');
      return true;
    case 'decline':
      if (mine) {
        if (cur === 'in') await put(peer, null);
        return false;
      }
      if (cur === 'out') {
        declined = { ...declined, [peer]: Date.now() };
        await put(peer, null);
      }
      return false;
    case 'cancel':
      if (mine ? cur === 'out' : cur === 'in') await put(peer, null);
      return false;
    case 'remove':
      if (cur) await put(peer, null);
      return false;
  }
  return false;
}

/** Block, report-and-block or profile gone: drop the friend state, nothing is sent (R-07.36). */
export async function forgetFriend(peer: string) {
  if (friends[peer]) await put(peer, null);
}

/** Device-only part of "Download my data" (R-07.38). */
export function exportPeople() {
  return { favorites: favList(), friends: { ...friends }, notes: { ...notes } };
}

/** Re-render when favorites, notes or friends change. */
export function usePeople() {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    loadPeople();
    return onPeople(bump);
  }, []);
  return tick;
}

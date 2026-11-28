// F-25 Refill (#339, D-26): bring back people you've met, at moments that make sense.
// Everything here runs on this phone (R-25.1): who you chatted with or met, your "Again?" answers,
// triggers and pacing never leave it. The server only knows each profile's `resurface` yes/no.
// A sealed yes travels inside the 1:1 E2EE chat (`{t:'refill'}`, engine.ts) and shows nothing on
// the other phone until both said yes.
import { useEffect, useReducer } from 'react';
import { kv } from '../chat/kv';

export const DAY = 86_400_000;
/** R-25.4: earliest 21 days after the last message. */
export const QUIET_AFTER = 21 * DAY;
/** R-25.4: nothing in the first 7 days on Thirstr. */
export const NEW_ACCOUNT = 7 * DAY;
/** R-25.5: one card per person per 60 days; "Not now" = 60 days. */
export const PER_PERSON = 60 * DAY;
/** R-25.5: one card a day. */
export const PER_DAY = DAY;
/** A card stays up to 24 h unless answered. */
export const CARD_TTL = DAY;
/** Sealed yes is valid 30 days. */
export const SEAL_TTL = 30 * DAY;
/** R-25.6 Back nearby: he was out of my Explore results for 14 days. */
export const AWAY = 14 * DAY;
/** R-25.6 Gone quiet: a favorite I haven't written to in 60 days. */
export const QUIET_FAV = 60 * DAY;

export type Trigger = 'nearby' | 'trip' | 'place' | 'tonight' | 'anniversary' | 'quiet';
export const TRIGGERS: Trigger[] = ['nearby', 'trip', 'place', 'tonight', 'anniversary', 'quiet'];
/** R-25.6 defaults (anniversary and gone quiet off). */
export const DEFAULT_TRIGGERS: Record<Trigger, boolean> = { nearby: true, trip: true, place: true, tonight: true, anniversary: false, quiet: false };

export type Rating = 'yes' | 'maybe' | 'no';

/** One person I've met or chatted with (device store). */
export type Rec = {
  /** "We met" or an ended date check-in. */
  met?: number;
  rating?: Rating;
  ratedAt?: number;
  /** "Not him again" (R-25.3), also set on block, unfriend, chat deleted. */
  muted?: boolean;
  /** Last time a card about him was shown. */
  carded?: number;
  /** "Not now" until. */
  later?: number;
  /** Last time he was in my Explore results. */
  seen?: number;
  /** My sealed yes, valid until. */
  out?: number;
  /** His sealed yes, valid until (never shown on its own). */
  in?: number;
  /** Both said yes. */
  matched?: number;
  /** Snapshot so Me › Refill shows him without a request. */
  name?: string;
  photo?: string | null;
};

export type Prefs = {
  /** null = never asked (intro card), false = off. */
  show: boolean | null;
  triggers: Record<Trigger, boolean>;
  snoozeUntil?: number;
  /** Last day a card was shown (pacing). */
  lastCard?: number;
};

export type Card = { kind: 'intro'; at: number } | { kind: 'person'; peer: string; trigger: Trigger; at: number; name: string; photo: string | null; where?: string };

type State = { recs: Record<string, Rec>; prefs: Prefs; card: Card | null };

const K = 'refill';
const fresh = (): State => ({ recs: {}, prefs: { show: null, triggers: { ...DEFAULT_TRIGGERS } }, card: null });
let st: State = fresh();
let loaded: Promise<void> | null = null;

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function onRefill(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** A mutual yes happened (UI shows the match screen; a local notification goes out in the background). */
export type MatchEvent = { peer: string; name: string; photo: string | null };
const matchSubs = new Set<(e: MatchEvent) => void>();
export function onMatch(fn: (e: MatchEvent) => void) {
  matchSubs.add(fn);
  return () => {
    matchSubs.delete(fn);
  };
}
/** An ended date asks "Again with …?" (concept C). */
const askSubs = new Set<(peer: string) => void>();
export function onAsk(fn: (peer: string) => void) {
  askSubs.add(fn);
  return () => {
    askSubs.delete(fn);
  };
}

export function loadRefill(): Promise<void> {
  loaded ??= (async () => {
    const s = await kv.get<State>(K);
    if (s) st = { recs: s.recs ?? {}, prefs: { ...fresh().prefs, ...s.prefs, triggers: { ...DEFAULT_TRIGGERS, ...s.prefs?.triggers } }, card: s.card ?? null };
    emit();
  })().catch(() => {
    loaded = null;
  });
  return loaded ?? Promise.resolve();
}

export function resetRefill() {
  st = fresh();
  loaded = null;
  emit();
}

async function save() {
  await kv.set(K, st);
  emit();
}

const put = (peer: string, patch: Partial<Rec>) => {
  st = { ...st, recs: { ...st.recs, [peer]: { ...st.recs[peer], ...patch } } };
};

export const prefs = () => st.prefs;
export const rec = (peer: string): Rec | null => st.recs[peer] ?? null;
export const currentCard = () => st.card;

// ------------------------------------------------------------------ pure rules

/** What the rules need to know about a chat (engine Conv, 1:1 only). */
export type ChatFacts = { peer: string; iWrote: boolean; theyWrote: boolean; lastAt: number; name: string; photo: string | null; fav?: boolean; friendRemoved?: boolean };
/** What the viewer side needs. */
export type Viewer = { plus: boolean; safeMode: boolean; createdAt: number | null; prefs: Prefs };

/** R-25.2/R-25.4/R-25.5: may this phone show Refill cards at all right now? */
export function viewerReady(v: Viewer, now: number): boolean {
  if (!v.plus || v.safeMode || v.prefs.show !== true) return false;
  if (v.createdAt !== null && now - v.createdAt < NEW_ACCOUNT) return false;
  if (v.prefs.snoozeUntil && now < v.prefs.snoozeUntil) return false;
  return true;
}

/** Past contact (Terms): a 1:1 chat with messages both ways, or a meetup. One-way chats never count. */
export const pastContact = (c: ChatFacts | null, r: Rec | null) => !!r?.met || !!(c && c.iWrote && c.theyWrote);

/**
 * R-25.3 / R-25.4 / R-25.5: may he come back now? `resurface` is his own switch (from his card).
 */
export function eligible(c: ChatFacts | null, r: Rec | null, resurface: boolean, now: number): boolean {
  if (!resurface || !pastContact(c, r)) return false;
  if (r?.muted || r?.rating === 'no' || c?.friendRemoved) return false;
  if (c && now - c.lastAt < QUIET_AFTER) return false;
  if (r?.later && now < r.later) return false;
  if (r?.carded && now - r.carded < PER_PERSON) return false;
  return true;
}

/** R-25.6: which trigger (if any) an observation makes, from the place it was seen. */
export function triggerFor(source: Trigger, c: ChatFacts | null, r: Rec | null, online: boolean, now: number, t: Record<Trigger, boolean>): Trigger | null {
  if (source === 'nearby') {
    // A year (or 6 months) since we met, and he's around: the anniversary wins over plain nearby.
    if (t.anniversary && r?.met && anniversary(r.met, now)) return 'anniversary';
    if (t.quiet && c?.fav && online && now - c.lastAt >= QUIET_FAV) return 'quiet';
    if (t.nearby && (!r?.seen || now - r.seen >= AWAY)) return 'nearby';
    return null;
  }
  return t[source] ? source : null;
}

/** 6 or 12 months (± 3 days) after the meetup, every year. */
export function anniversary(met: number, now: number): boolean {
  const d = (now - met) / DAY;
  if (d < 170) return false;
  const inYear = d % 365;
  return Math.abs(inYear - 182) <= 3 || inYear <= 3 || inYear >= 362;
}

/** R-25.5: a new card may replace nothing (one at a time) and at most one a day. */
export function cardDue(p: Prefs, card: Card | null, now: number): boolean {
  if (card && now - card.at < CARD_TTL) return false;
  return !p.lastCard || now - p.lastCard >= PER_DAY;
}

/** Trigger order when several people qualify at once: the moment that's most "now" first. */
const RANK: Record<Trigger, number> = { place: 0, tonight: 1, trip: 2, anniversary: 3, nearby: 4, quiet: 5 };

/** Mutual yes? Both sides unexpired, not matched yet. */
export const mutual = (r: Rec | null, now: number) => !!r && !r.matched && !!r.out && r.out > now && !!r.in && r.in > now;

// ------------------------------------------------------------------ observations (triggers)

export type Seen = { id: string; resurface?: boolean; online?: boolean; name?: string; photo?: string | null; where?: string };

/**
 * Feed people the app just loaded for another reason (Explore grid, visitors, a party's guests,
 * a venue's "here now", the Tonight board). Picks at most one card. Nothing is sent anywhere.
 */
export async function observe(source: Trigger, people: Seen[], chats: Map<string, ChatFacts>, viewer: Viewer, now = Date.now()) {
  await loadRefill();
  let best: { s: Seen; t: Trigger } | null = null;
  const ready = viewerReady({ ...viewer, prefs: st.prefs }, now);
  for (const s of people) {
    const c = chats.get(s.id) ?? null;
    const r = st.recs[s.id] ?? null;
    if (!pastContact(c, r)) continue;
    const t = ready && cardDue(st.prefs, st.card, now) && eligible(c, r, s.resurface === true, now) ? triggerFor(source, c, r, !!s.online, now, st.prefs.triggers) : null;
    if (source === 'nearby') put(s.id, { seen: now });
    if (t && (!best || RANK[t] < RANK[best.t])) best = { s, t };
  }
  if (best) {
    const c = chats.get(best.s.id);
    const name = c?.name ?? best.s.name ?? '…';
    const photo = c?.photo ?? best.s.photo ?? null;
    st = { ...st, card: { kind: 'person', peer: best.s.id, trigger: best.t, at: now, name, photo, where: best.s.where }, prefs: { ...st.prefs, lastCard: now } };
    put(best.s.id, { carded: now, name, photo });
  } else if (st.prefs.show === null && !st.card && viewer.createdAt !== null && now - viewer.createdAt >= NEW_ACCOUNT && !viewer.safeMode && [...chats.values()].some((c) => pastContact(c, null))) {
    // R-25.2: ask once, the first time Refill could matter.
    st = { ...st, card: { kind: 'intro', at: now } };
  }
  await save();
}

// ------------------------------------------------------------------ card actions

export async function dismissCard(later: boolean, now = Date.now()) {
  const c = st.card;
  st = { ...st, card: null };
  if (c?.kind === 'person' && later) put(c.peer, { later: now + PER_PERSON });
  await save();
}

/** "Not him again" (R-25.3): silent, device-only. Also used on block, unfriend, chat deleted. */
export async function mute(peer: string, on = true) {
  put(peer, { muted: on || undefined });
  if (on && st.card?.kind === 'person' && st.card.peer === peer) st = { ...st, card: null };
  await save();
}
export const mutedList = () => Object.entries(st.recs).filter(([, r]) => r.muted).map(([peer, r]) => ({ peer, ...r }));

/** Forget everything about him (R-25.7 "Forget"). */
export async function forget(peer: string) {
  const { [peer]: _gone, ...rest } = st.recs;
  st = { ...st, recs: rest, card: st.card?.kind === 'person' && st.card.peer === peer ? null : st.card };
  await save();
}

export async function setPrefs(p: Partial<Prefs>) {
  st = { ...st, prefs: { ...st.prefs, ...p, triggers: { ...st.prefs.triggers, ...p.triggers } } };
  if (p.show !== undefined && st.card?.kind === 'intro') st = { ...st, card: null };
  await save();
}

// ------------------------------------------------------------------ concept C: after the date

/** "We met" (chat ⋯) or an ended date check-in with him: remember it and ask "Again?". */
export async function markMet(peer: string, snap?: { name?: string; photo?: string | null }, ask = true, now = Date.now()) {
  await loadRefill();
  put(peer, { met: st.recs[peer]?.met ?? now, ...snap });
  await save();
  if (ask) askSubs.forEach((f) => f(peer));
}

export async function rate(peer: string, rating: Rating | null, now = Date.now()) {
  put(peer, { rating: rating ?? undefined, ratedAt: rating ? now : undefined, met: st.recs[peer]?.met ?? now });
  if (rating === 'no' && st.card?.kind === 'person' && st.card.peer === peer) st = { ...st, card: null };
  await save();
}

/** Me › Refill (R-25.8): everyone I rated, newest first. */
export function book(rating: Rating) {
  return Object.entries(st.recs)
    .filter(([, r]) => r.rating === rating)
    .map(([peer, r]) => ({ peer, ...r }))
    .sort((a, b) => (b.ratedAt ?? 0) - (a.ratedAt ?? 0));
}

// ------------------------------------------------------------------ concept A: sealed yes

export type RefillPayload = { t: 'refill'; op: 'yes' | 'withdraw'; until?: number };

/** My side: seal a yes (or take it back). Returns the payload to send and whether it's a match now. */
export async function sealMine(peer: string, on: boolean, snap: { name: string; photo: string | null }, now = Date.now()): Promise<{ p: RefillPayload; match: boolean }> {
  await loadRefill();
  const until = now + SEAL_TTL;
  // The card stays (it shows the sealed state until it expires).
  put(peer, on ? { out: until, ...snap } : { out: undefined });
  const match = on && mutual(st.recs[peer], now);
  if (match) put(peer, { matched: now });
  await save();
  if (match) matchSubs.forEach((f) => f({ peer, name: snap.name, photo: snap.photo }));
  return { p: on ? { t: 'refill', op: 'yes', until } : { t: 'refill', op: 'withdraw' }, match };
}

/** His side arrived (silent). Shows nothing unless I already said yes too. */
export async function receiveSeal(peer: string, p: RefillPayload, snap: { name: string; photo: string | null }, now = Date.now()): Promise<boolean> {
  await loadRefill();
  if (st.recs[peer]?.muted) return false;
  if (p.op === 'withdraw') {
    put(peer, { in: undefined });
    await save();
    return false;
  }
  const until = Math.min(typeof p.until === 'number' ? p.until : now + SEAL_TTL, now + SEAL_TTL);
  if (until <= now) return false;
  put(peer, { in: until });
  const match = mutual(st.recs[peer], now);
  if (match) put(peer, { matched: now, ...snap });
  await save();
  if (match) matchSubs.forEach((f) => f({ peer, ...snap }));
  return match;
}

/** My yes is waiting (for the "Sealed" state on the card and in Me › Refill). */
export const sealed = (peer: string, now = Date.now()) => !!st.recs[peer]?.out && st.recs[peer]!.out! > now;

/** Device-only part of "Download my data" (R-25.7). His sealed yes is left out: it's his. */
export function exportRefill() {
  const recs: Record<string, Omit<Rec, 'in'>> = {};
  for (const [peer, r] of Object.entries(st.recs)) {
    const { in: _his, ...mine } = r;
    recs[peer] = mine;
  }
  return { prefs: st.prefs, people: recs };
}

export function useRefill() {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    loadRefill();
    return onRefill(bump);
  }, []);
  return tick;
}

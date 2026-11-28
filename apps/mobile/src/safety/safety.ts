// F-13 trusted contacts + meet check-in + panic (F13-safety.md › Beta implementation).
// Contacts (label, relay id, rid, key) are device-only; the server relays AES-GCM envelopes.
import { Platform } from 'react-native';
import { markMet } from '../refill/refill';
import { api } from '../api/client';
import { fromB64, fromB64url, fromUtf8, rand, toB64, toB64url, utf8 } from '../chat/bytes';
import { kv } from '../chat/kv';
import { currentPosition } from '../explore/location';

export type Contact = { id: string; rid: string; key: string; label: string; accepted?: boolean; push?: boolean };
export type Loc = { lat: number; lng: number; acc?: number; at: string };
export type Who = { name: string; age?: number; link?: string };
export type ChatLine = { me: boolean; text: string; at: string };
export type Active = { token: string; due: string; ext: number; name: string; who?: Who; msgs?: ChatLine[]; live: boolean; notif?: string; cid?: string; peer?: string; started?: string };
type Env = { k: 'invite' | 'notice' | 'alert' | 'panic' | 'ok' | 'loc'; from: string; at: string; due?: string; loc?: Loc; who?: Who; msgs?: ChatLine[] };

// Contact page lives on the site host (api.thirstr.fun → thirstr.fun; staging and DEV same origin).
const API = process.env.EXPO_PUBLIC_API_URL || (typeof location !== 'undefined' ? location.origin : 'https://thirstr.fun');
const SITE = API.replace('://api.', '://');
const K_CONTACTS = 'safety:contacts';
const K_ACTIVE = 'safety:checkin';
const K_NAME = 'safety:name';
/** R-13.19: notification category with I'm OK / +30 min actions. */
export const CATEGORY = 'checkin';

// ------------------------------------------------------------------ envelope

export async function seal(keyB64url: string, body: Env): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromB64url(keyB64url) as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, utf8(JSON.stringify(body)) as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

/** Used by tests and the contact page logic (mirrors web/site/c/app.js). */
export async function open(keyB64url: string, wire: string): Promise<Env> {
  const raw = fromB64(wire);
  const key = await crypto.subtle.importKey('raw', fromB64url(keyB64url) as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) as BufferSource }, key, raw.slice(12) as BufferSource));
  return JSON.parse(fromUtf8(pt)) as Env;
}

// ------------------------------------------------------------------ contacts

export const myName = async (fallback: string) => (await kv.get<string>(K_NAME)) ?? fallback;
export const setMyName = (n: string) => kv.set(K_NAME, n.trim().slice(0, 40));

export async function contacts(): Promise<Contact[]> {
  const local = (await kv.get<Contact[]>(K_CONTACTS)) ?? [];
  try {
    const r = await api<{ contacts: { id: string; accepted: boolean; push: boolean }[] }>('GET', '/trusted');
    const byId = new Map(r.contacts.map((c) => [c.id, c]));
    // opted out or removed elsewhere → gone here too (R-13.3)
    const next = local.filter((c) => byId.has(c.id)).map((c) => ({ ...c, accepted: byId.get(c.id)!.accepted, push: byId.get(c.id)!.push }));
    await kv.set(K_CONTACTS, next);
    return next;
  } catch {
    return local;
  }
}

export const link = (c: Contact) => `${SITE}/c/#${c.rid}.${c.key}`;
/** #247 R-07.46: only our own trusted-contact page opens from a chat card. */
export const isInviteLink = (u: string) => typeof u === 'string' && u.startsWith(`${SITE}/c/#`) && u.length < 300;

export async function invite(label: string, from: string): Promise<Contact> {
  const key = toB64url(rand(32));
  const intro = await seal(key, { k: 'invite', from, at: new Date().toISOString() });
  const r = await api<{ id: string; rid: string }>('POST', '/trusted/invite', { intro });
  const c: Contact = { id: r.id, rid: r.rid, key, label: label.trim().slice(0, 40) || from, accepted: false };
  await kv.set(K_CONTACTS, [...((await kv.get<Contact[]>(K_CONTACTS)) ?? []), c]);
  return c;
}

export async function removeContact(id: string) {
  await api('DELETE', `/trusted/${id}`).catch(() => {});
  await kv.set(K_CONTACTS, ((await kv.get<Contact[]>(K_CONTACTS)) ?? []).filter((c) => c.id !== id));
}

const accepted = async () => (await contacts()).filter((c) => c.accepted);

async function here(): Promise<Loc | undefined> {
  const p = await currentPosition().catch(() => null);
  return p ? { lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5, at: new Date().toISOString() } : undefined;
}

async function envs(list: Contact[], body: Omit<Env, 'at'>) {
  const at = new Date().toISOString();
  return Promise.all(list.map(async (c) => ({ relay: c.id, ciphertext: await seal(c.key, { ...body, at }) })));
}

// ------------------------------------------------------------------ check-in

export const active = () => kv.get<Active>(K_ACTIVE);

// R-13.16: the live bar, chat shield and quick sheet follow the running check-in.
const subs = new Set<(a: Active | null) => void>();
export function onActive(cb: (a: Active | null) => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
const emit = (a: Active | null) => subs.forEach((cb) => cb(a));
async function save(a: Active) {
  await kv.set(K_ACTIVE, a);
  emit(a);
  return a;
}

async function scheduleDue(a: Active) {
  if (Platform.OS === 'web') return a;
  const N = await import('expo-notifications');
  if (a.notif) await N.cancelScheduledNotificationAsync(a.notif).catch(() => {});
  const notif = await N.scheduleNotificationAsync({
    content: { title: 'Thirstr', body: 'All good?', data: { checkin: true }, sound: 'default', categoryIdentifier: CATEGORY },
    trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(a.due) },
  }).catch(() => undefined);
  return { ...a, notif };
}

async function clearActive() {
  const a = await active();
  if (a?.notif && Platform.OS !== 'web') {
    const N = await import('expo-notifications');
    await N.cancelScheduledNotificationAsync(a.notif).catch(() => {});
  }
  await kv.del(K_ACTIVE);
  emit(null);
}

export async function startCheckin(o: { minutes: number; name: string; who?: Who; msgs?: ChatLine[]; live: boolean; cid?: string; peer?: string }): Promise<Active> {
  const list = await accepted();
  if (!list.length) throw new Error('no_contacts');
  const due = new Date(Date.now() + o.minutes * 60_000).toISOString();
  const loc = await here();
  const notices = await envs(list, { k: 'notice', from: o.name, due });
  const alerts = await envs(list, { k: 'alert', from: o.name, due, loc, who: o.who, msgs: o.msgs });
  const r = await api<{ token: string; due_at: string }>('POST', '/checkin', { due_at: due, notices, alerts });
  const a = await scheduleDue({ token: r.token, due: r.due_at, ext: 0, name: o.name, who: o.who, msgs: o.msgs, live: o.live, cid: o.cid, peer: o.peer, started: new Date().toISOString() });
  return save(a);
}

/** Every 5 min while the app runs: fresh location in the held alert; live → also a `loc` now. */
export async function refreshCheckin() {
  const a = await active();
  if (!a) return;
  const list = await accepted();
  const loc = await here();
  const alerts = await envs(list, { k: 'alert', from: a.name, due: a.due, loc, who: a.who, msgs: a.msgs });
  const live = a.live && loc ? await envs(list, { k: 'loc', from: a.name, loc }) : [];
  await api('PUT', `/checkin/${a.token}/alerts`, { alerts, live }).catch(async (e) => {
    if ((e as { status?: number }).status === 404) await clearActive();
  });
}

export async function extendCheckin(): Promise<Active | null> {
  const a = await active();
  if (!a) return null;
  const list = await accepted();
  const due = new Date(new Date(a.due).getTime() + 30 * 60_000).toISOString();
  const alerts = await envs(list, { k: 'alert', from: a.name, due, loc: await here(), who: a.who, msgs: a.msgs });
  const r = await api<{ due_at: string }>('POST', `/checkin/${a.token}/extend`, { alerts });
  return save(await scheduleDue({ ...a, due: r.due_at, ext: a.ext + 1 }));
}

/** R-13.17: live location on/off for the running check-in; on → a `loc` goes out now. */
export async function setLive(on: boolean) {
  const a = await active();
  if (!a) return null;
  const next = await save({ ...a, live: on });
  if (on) await refreshCheckin().catch(() => {});
  return next;
}

export async function okCheckin() {
  const a = await active();
  if (!a) return;
  const oks = await envs(await accepted(), { k: 'ok', from: a.name });
  await api('POST', `/checkin/${a.token}/ok`, { oks }).catch(() => {});
  await clearActive();
  // F-25 concept C (#339): a date with him ended well → remember it and ask "Again?" (device-only).
  if (a.peer) await markMet(a.peer).catch(() => {});
}

/** SOS / duress: release now with the current location (R-13.8, R-13.9). */
export async function panic(fallbackName: string) {
  const a = await active();
  const name = a?.name ?? (await myName(fallbackName));
  const alerts = await envs(await accepted(), { k: 'panic', from: name, loc: await here(), who: a?.who, msgs: a?.msgs, due: a?.due });
  if (!alerts.length) throw new Error('no_contacts');
  if (a) {
    await api('POST', `/checkin/${a.token}/panic`, { alerts }).catch(() => api('POST', '/checkin/panic', { alerts }));
    await clearActive();
  } else {
    await api('POST', '/checkin/panic', { alerts });
  }
}

/** Server state wins (e.g. alert already fired, or OK from another device). */
export async function syncActive(): Promise<Active | null> {
  const a = await active();
  if (!a) return null;
  const r = await api<{ checkin: null | { due_at: string; extensions: number } }>('GET', '/checkin').catch(() => undefined);
  if (r && !r.checkin) {
    await clearActive();
    return null;
  }
  return a;
}

/** #127, R-13.21: the server runs a check-in this phone has no copy of (reinstall, wipe). */
export type Orphan = { due: string; ext: number };

export async function orphanCheckin(): Promise<Orphan | null> {
  if (await active()) return null;
  const r = await api<{ checkin: null | { due_at: string; extensions: number } }>('GET', '/checkin').catch(() => undefined);
  return r?.checkin ? { due: r.checkin.due_at, ext: r.checkin.extensions } : null;
}

/** I'm OK for an orphan: ends it by account (no token); `ok` to the contacts this phone still knows. */
export async function endOrphan(fallbackName: string) {
  const oks = await envs(await accepted(), { k: 'ok', from: await myName(fallbackName) });
  await api('DELETE', '/checkin', { oks }).catch((e) => {
    if ((e as { status?: number }).status !== 404) throw e;
  });
}

/** R-13.8: local emergency number from the device region (default 112). */
export function emergencyNumber(region?: string | null) {
  const r = (region ?? '').toUpperCase();
  if (['US', 'CA', 'MX', 'PR'].includes(r)) return '911';
  if (['GB', 'IE', 'HK', 'MY', 'SG'].includes(r)) return r === 'SG' ? '995' : '999';
  if (['AU'].includes(r)) return '000';
  if (['NZ'].includes(r)) return '111';
  return '112';
}

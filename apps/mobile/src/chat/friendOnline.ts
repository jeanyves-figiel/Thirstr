// #247 R-07.48 (F-16): "Tell me when he's online" for up to 20 friends. Checked only while Thirstr
// is open or comes back to the foreground (every 10 min), with the same profile view the app already
// uses; a local notification on offline → online, at most once per friend per 2 h. Nothing new is
// stored on the server.
import { Platform } from 'react-native';
import { api } from '../api/client';
import { kv } from './kv';
import * as People from './people';

export const MAX = 20;
export const EVERY_MS = 10 * 60_000;
export const QUIET_MS = 2 * 3600_000;

export type Watch = { online?: boolean; told?: number };
const K = 'fonline';

let watch: Record<string, Watch> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

async function load() {
  if (!watch) watch = (await kv.get<Record<string, Watch>>(K)) ?? {};
  return watch;
}
async function save(next: Record<string, Watch>) {
  watch = next;
  await kv.set(K, next);
  emit();
}

export const isWatched = (peer: string) => !!watch?.[peer];
export const count = () => Object.keys(watch ?? {}).length;

export function onWatch(fn: () => void) {
  subs.add(fn);
  void load().then(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Returns false when the limit is reached. */
export async function setWatched(peer: string, on: boolean): Promise<boolean> {
  const w = await load();
  if (!on) {
    const { [peer]: _gone, ...rest } = w;
    await save(rest);
    return true;
  }
  if (!w[peer] && Object.keys(w).length >= MAX) return false;
  await save({ ...w, [peer]: w[peer] ?? {} });
  return true;
}

/** Pure: notify on this transition? */
export function shouldTell(prev: Watch, online: boolean, now = Date.now()) {
  return online && prev.online === false && (!prev.told || now - prev.told >= QUIET_MS);
}

let lastRun = 0;
let running = false;

/** One pass (skips if run less than 10 min ago unless forced). */
export async function check(names: (peer: string) => string, force = false) {
  if (running || (!force && Date.now() - lastRun < EVERY_MS)) return;
  running = true;
  lastRun = Date.now();
  try {
    const w = await load();
    const next = { ...w };
    for (const peer of Object.keys(w)) {
      if (People.friendOf(peer) !== 'yes') {
        delete next[peer];
        continue;
      }
      const r = await api<{ online?: boolean }>('GET', `/profiles/${peer}`).catch(() => null);
      if (!r) continue;
      const online = !!r.online;
      const prev = w[peer];
      const tell = shouldTell(prev, online);
      next[peer] = { online, told: tell ? Date.now() : prev.told };
      if (tell) await notify(names(peer));
    }
    await save(next);
  } finally {
    running = false;
  }
}

async function notify(name: string) {
  if (Platform.OS === 'web') return;
  const { ppl } = await import('../i18n/people');
  const N = await import('expo-notifications');
  await N.scheduleNotificationAsync({ content: { title: 'Thirstr', body: ppl.onlineNow(name), sound: 'default' }, trigger: null }).catch(() => {});
}

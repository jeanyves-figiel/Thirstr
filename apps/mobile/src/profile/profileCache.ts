// F-19 G10 (#187): profiles seen while swiping through the grid. The neighbours of the open profile are
// fetched ahead (data + first photo), so a swipe lands on a ready profile with no spinner. Memory only,
// capped, gone after an app restart. Profiles that answer 404/403 are skipped by the swipe.
// SR-16 (#156): profiles you opened are also kept 24 h in the encrypted device store, shown at once
// (and offline) while the fresh copy loads. Wiped with the store on sign-out / panic wipe.
import { Image } from 'react-native';
import { kv } from '../chat/kv';
import { api, ApiError } from '../api/client';
import type { Mode, ProfileView } from '../api/types';
import { saving } from '../app/dataSaver';

const MAX = 24;
const cache = new Map<string, ProfileView>();
const inflight = new Map<string, Promise<ProfileView | null>>();
const dead = new Set<string>();

const STORE = 'cache:profile:';
const STORE_TTL = 24 * 3600_000;
const STORE_MAX = 200;
let writes = 0;

export const profileKey = (id: string, mode: Mode, trip?: string) => `${id}|${mode}|${trip ?? ''}`;
const url = (id: string, mode: Mode, trip?: string) => `/profiles/${id}?mode=${mode}${trip ? `&trip_id=${trip}` : ''}`;

export function cachedProfile(id: string, mode: Mode, trip?: string): ProfileView | undefined {
  return cache.get(profileKey(id, mode, trip));
}

export function putProfile(v: ProfileView, mode: Mode, trip?: string) {
  const k = profileKey(v.id, mode, trip);
  cache.delete(k);
  cache.set(k, v);
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
}

/** Opened profile → encrypted store (SR-16). Every 20 writes, expired and surplus entries go. */
export async function storeProfile(v: ProfileView, mode: Mode, trip?: string, now = Date.now()) {
  try {
    await kv.set(STORE + profileKey(v.id, mode, trip), { at: now, v });
    if (++writes % 20 === 0) await pruneStored(now);
  } catch {
    // best effort
  }
}

export async function storedProfile(id: string, mode: Mode, trip?: string, now = Date.now()): Promise<ProfileView | null> {
  try {
    const e = await kv.get<{ at: number; v: ProfileView }>(STORE + profileKey(id, mode, trip));
    return e && now - e.at < STORE_TTL ? e.v : null;
  } catch {
    return null;
  }
}

export async function pruneStored(now = Date.now()) {
  const keys = await kv.keys(STORE);
  const all = await Promise.all(keys.map(async (k) => ({ k, at: (await kv.get<{ at: number }>(k))?.at ?? 0 })));
  all.sort((a, b) => b.at - a.at);
  for (const [i, e] of all.entries()) if (i >= STORE_MAX || now - e.at >= STORE_TTL) await kv.del(e.k);
}

async function dropStored(id: string) {
  try {
    for (const k of await kv.keys(STORE + id + '|')) await kv.del(k);
  } catch {
    // best effort
  }
}

export const isDead = (id: string) => dead.has(id);
export const markDead = (id: string) => dead.add(id);

/** Loads a profile into the cache (shared in-flight request). Null = not available (404 / 403). */
export function fetchProfile(id: string, mode: Mode, trip?: string): Promise<ProfileView | null> {
  const k = profileKey(id, mode, trip);
  const run = inflight.get(k);
  if (run) return run;
  const p = api<ProfileView>('GET', url(id, mode, trip))
    .then(
      (v) => {
        putProfile(v, mode, trip);
        dead.delete(id);
        return v;
      },
      (e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
          dead.add(id);
          void dropStored(id);
          return null;
        }
        throw e;
      },
    )
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Fetch ahead: data and first photo of a neighbour. Errors are ignored (the swipe retries on arrival). */
export function warmProfile(id: string, mode: Mode, trip?: string): Promise<ProfileView | null> {
  const have = cachedProfile(id, mode, trip);
  if (saving()) return Promise.resolve(have ?? null); // R-17.16: nothing loaded ahead
  const p = have ? Promise.resolve(have) : fetchProfile(id, mode, trip);
  return p.then(
    (v) => {
      const first = v?.photos[0];
      if (first) Image.prefetch(first).catch(() => {});
      return v;
    },
    () => null,
  );
}

/** Next index in `ids` from `at` in direction `d`, skipping profiles known to be unavailable. −1 = none. */
export function stepIndex(ids: string[], at: number, d: -1 | 1, skip: (id: string) => boolean = isDead): number {
  for (let k = at + d; k >= 0 && k < ids.length; k += d) if (!skip(ids[k])) return k;
  return -1;
}

export function _resetProfileCache() {
  cache.clear();
  inflight.clear();
  dead.clear();
}

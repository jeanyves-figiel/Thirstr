// Local message store (F-07 R-07.21): one encrypted row per message, no cap. Only the
// disappearing timer, view-once, "Delete for me" and chat delete remove messages.
// Every change to one conversation runs through `lock`, so a send and a receive at the same
// moment can't overwrite each other.
import { kv } from './kv';

/** Ordering + identity fields every stored message carries. */
export type Row = { id: string; at: number; seq?: number };

const key = (cid: string, id: string) => `m:${cid}\u0001${id}`;
const prefix = (cid: string) => `m:${cid}\u0001`;
/** On-device translation cache of one message (F-07 R-07.30). */
export const trKey = (cid: string, id: string) => `tr:${cid}\u0001${id}`;

const cache = new Map<string, Row[]>();
/** SR-15 (#155): decrypted rows of the most recently used chats only; older ones reload from disk. */
const CACHE_CHATS = 12;
function touch(cid: string, list: Row[]) {
  cache.delete(cid);
  cache.set(cid, list);
  while (cache.size > CACHE_CHATS) {
    const oldest = cache.keys().next().value as string;
    if (locks.has('c:' + oldest)) break; // never evict a chat that is being edited
    cache.delete(oldest);
  }
}
const locks = new Map<string, Promise<unknown>>();
let seq = 0;

/** Runs `fn` after every earlier `lock(name)` call has finished (FIFO per name). */
export function lock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(name, tail);
  tail.then(() => {
    if (locks.get(name) === tail) locks.delete(name);
  });
  return run;
}

const order = (a: Row, b: Row) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0);

/** All messages of a conversation, oldest first. */
export async function all<T extends Row>(cid: string): Promise<T[]> {
  let list = cache.get(cid);
  if (!list) {
    list = (await kv.getPrefix<Row>(prefix(cid))).sort(order);
    for (const r of list) seq = Math.max(seq, r.seq ?? 0);
    // Older builds kept one JSON blob per chat (capped at 500): move it to rows once.
    const legacy = await kv.get<Row[]>('msgs:' + cid);
    if (legacy) {
      const have = new Set(list.map((r) => r.id));
      for (const r of legacy) {
        if (have.has(r.id)) continue;
        const row = { ...r, seq: ++seq };
        await kv.set(key(cid, r.id), row);
        list.push(row);
      }
      await kv.del('msgs:' + cid);
      list.sort(order);
    }
    touch(cid, list);
  } else touch(cid, list);
  return list.map((r) => ({ ...r })) as T[];
}

/**
 * SR-15 (#155): the newest `n` messages for a fast first paint of a chat that isn't cached yet;
 * the full list (`all`) follows. Doesn't fill the cache.
 */
export async function recent<T extends Row>(cid: string, n: number): Promise<T[]> {
  const hit = cache.get(cid);
  if (hit) return hit.slice(-n).map((r) => ({ ...r })) as T[];
  return kv.tail<T>(prefix(cid), n);
}

/** True when `all(cid)` will answer from memory. */
export const cached = (cid: string) => cache.has(cid);

/** Inserts or replaces one message (keeps its arrival order on replace). */
export async function put<T extends Row>(cid: string, m: T): Promise<T> {
  const list = (await all<T>(cid)) as Row[];
  const i = list.findIndex((x) => x.id === m.id);
  const row = { ...m, seq: i >= 0 ? (list[i].seq ?? ++seq) : ++seq };
  await kv.set(key(cid, m.id), row);
  const cur = cache.get(cid)!;
  const j = cur.findIndex((x) => x.id === m.id);
  if (j >= 0) cur[j] = row;
  else cur.push(row);
  cur.sort(order);
  return row as T;
}

export async function remove(cid: string, ids: string[]) {
  if (!ids.length) return;
  await all(cid);
  for (const id of ids) {
    await kv.del(key(cid, id));
    await kv.del(trKey(cid, id)); // R-07.30: its on-device translation goes with it
  }
  const set = new Set(ids);
  cache.set(
    cid,
    cache.get(cid)!.filter((r) => !set.has(r.id)),
  );
}

export async function drop(cid: string) {
  await kv.delPrefix(prefix(cid));
  await kv.delPrefix(`tr:${cid}\u0001`);
  await kv.del('msgs:' + cid);
  cache.delete(cid);
}

export function reset() {
  cache.clear();
  seq = 0;
}

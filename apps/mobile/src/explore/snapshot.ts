// SR-16 (#156): last Explore first page kept in the encrypted device store, shown at once on
// the next open (or offline) and replaced by the fresh answer. Wiped with the store on sign-out
// and panic wipe. Holds only what the API already showed; one snapshot, max 60 cards, 24 h.
import { kv } from '../chat/kv';
import type { Card } from '../api/types';

const KEY = 'cache:explore';
const MAX_CARDS = 60;
const TTL_MS = 24 * 3600_000;

export type Snapshot = { sig: string; at: number; items: Card[]; tray: Card[] };

export const snapshotSig = (o: unknown) => JSON.stringify(o);

export async function readSnapshot(sig: string, now = Date.now()): Promise<Snapshot | null> {
  try {
    const s = await kv.get<Snapshot>(KEY);
    return s && s.sig === sig && now - s.at < TTL_MS ? s : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(sig: string, items: Card[], tray: Card[], now = Date.now()) {
  try {
    await kv.set(KEY, { sig, at: now, items: items.slice(0, MAX_CARDS), tray: tray.slice(0, MAX_CARDS) } satisfies Snapshot);
  } catch {
    // best effort
  }
}

export async function clearSnapshot() {
  await kv.del(KEY).catch(() => {});
}

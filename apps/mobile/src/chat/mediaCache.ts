// SR-05 (#145): chat/album media kept on this phone after the first download, so history keeps
// its photos after the server copy expires (≤ 30 d, R-08.10) and nothing is downloaded twice.
// Files hold the *ciphertext* exactly as downloaded (AES-256-GCM); the key only exists inside the
// message row in the SQLCipher store, so a file alone is unreadable. View-once media is never
// cached. LRU-capped (MAX_BYTES); expired entries (sender timer) are dropped; wiped with the store.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { kv } from './kv';

type Entry = { size: number; at: number; exp?: number };
const K = 'mcache.index';
const WEB = Platform.OS === 'web';
export const MAX_BYTES = 300 * 1024 * 1024;

let index: Record<string, Entry> | null = null;
const load = async () => (index ??= (await kv.get<Record<string, Entry>>(K)) ?? {});
const save = () => kv.set(K, index ?? {});

function dir() {
  const d = new Directory(Paths.document, 'media');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}
const file = (blob: string) => new File(dir(), `${blob.replace(/[^0-9a-f-]/gi, '')}.bin`);

export async function get(blob: string): Promise<Uint8Array | null> {
  if (WEB) return null;
  const idx = await load();
  const e = idx[blob];
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) {
    await drop(blob);
    return null;
  }
  const f = file(blob);
  if (!f.exists) {
    delete idx[blob];
    await save();
    return null;
  }
  e.at = Date.now();
  save().catch(() => {});
  return f.bytes();
}

export async function put(blob: string, ct: Uint8Array, opts: { once?: boolean; exp?: number } = {}) {
  if (WEB || opts.once) return;
  const idx = await load();
  const f = file(blob);
  if (f.exists) f.delete();
  f.create();
  f.write(ct);
  idx[blob] = { size: ct.length, at: Date.now(), exp: opts.exp };
  await evict(idx);
  await save();
}

/** Size of a cached file (0 when not here). R-01.14 estimates the transfer with it. */
export async function sizeOf(blob: string): Promise<number> {
  if (WEB) return 0;
  return (await load())[blob]?.size ?? 0;
}

export async function drop(blob: string) {
  if (WEB) return;
  const idx = await load();
  const f = file(blob);
  if (f.exists) f.delete();
  delete idx[blob];
  await save();
}

/** Oldest-used first until under the cap; expired ones always. */
async function evict(idx: Record<string, Entry>) {
  const now = Date.now();
  for (const [b, e] of Object.entries(idx)) if (e.exp && e.exp < now) dropSync(idx, b);
  let total = Object.values(idx).reduce((n, e) => n + e.size, 0);
  for (const [b, e] of Object.entries(idx).sort((x, y) => x[1].at - y[1].at)) {
    if (total <= MAX_BYTES) break;
    total -= e.size;
    dropSync(idx, b);
  }
}

function dropSync(idx: Record<string, Entry>, blob: string) {
  const f = file(blob);
  if (f.exists) f.delete();
  delete idx[blob];
}

/** Sign-out / wipe: delete every cached file (index goes with kv.wipe). */
export async function clear() {
  index = null;
  if (WEB) return;
  const d = new Directory(Paths.document, 'media');
  if (d.exists) d.delete();
}

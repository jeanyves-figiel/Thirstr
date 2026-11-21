// F-08 R-08.14 "Sent recently": photos this phone sent, kept only on this phone.
// Each photo is a ciphertext file (AES-256-GCM, own random key); keys and index live in the
// SQLCipher store (`recent.media`). Re-sending uploads a new copy with a new key (never the old blob).
import { gcm } from '@noble/ciphers/aes.js';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { fromB64, hex, rand, toB64 } from './bytes';
import { kv } from './kv';

export type Recent = { id: string; key: string; iv: string; mime: string; w?: number; h?: number; at: number; to: string[] };

const K = 'recent.media';
const WEB = Platform.OS === 'web';
/** Last 30 photos (8 on the web DEV build, which keeps the ciphertext in localStorage). */
export const MAX = WEB ? 8 : 30;

const emit = new Set<() => void>();
export const onRecent = (fn: () => void) => {
  emit.add(fn);
  return () => {
    emit.delete(fn);
  };
};

async function fs() {
  const dir = new Directory(Paths.document, 'recent');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return { file: (id: string) => new File(dir, `${id}.bin`), dir };
}

async function writeBlob(id: string, ct: Uint8Array) {
  if (WEB) return kv.set(`recent.blob:${id}`, toB64(ct));
  const { file } = await fs();
  const f = file(id);
  if (f.exists) f.delete();
  f.create();
  f.write(ct);
}

async function readBlob(id: string): Promise<Uint8Array | null> {
  if (WEB) {
    const b = await kv.get<string>(`recent.blob:${id}`);
    return b ? fromB64(b) : null;
  }
  const { file } = await fs();
  const f = file(id);
  return f.exists ? f.bytes() : null;
}

async function dropBlob(id: string) {
  if (WEB) return kv.del(`recent.blob:${id}`);
  const { file } = await fs();
  const f = file(id);
  if (f.exists) f.delete();
}

export const list = async () => (await kv.get<Recent[]>(K)) ?? [];

async function save(next: Recent[]) {
  await kv.set(K, next);
  emit.forEach((f) => f());
}

/** Keeps a sent photo (already re-encoded, no EXIF). Trims to MAX, deleting the oldest files. */
export async function keep(bytes: Uint8Array, meta: { mime: string; w?: number; h?: number }, cid: string) {
  const id = hex(rand(8));
  const key = rand(32);
  const iv = rand(12);
  try {
    await writeBlob(id, gcm(key, iv).encrypt(bytes));
  } catch {
    return null; // storage full or quota (web): sending already worked, keep nothing.
  }
  const all = [{ id, key: toB64(key), iv: toB64(iv), ...meta, at: Date.now(), to: [cid] }, ...(await list())];
  for (const old of all.slice(MAX)) await dropBlob(old.id).catch(() => {});
  await save(all.slice(0, MAX));
  return id;
}

/** Decrypted bytes of a kept photo (memory only). */
export async function bytes(r: Recent): Promise<Uint8Array | null> {
  const ct = await readBlob(r.id).catch(() => null);
  if (!ct) return null;
  try {
    return gcm(fromB64(r.key), fromB64(r.iv)).decrypt(ct);
  } catch {
    return null;
  }
}

const uris = new Map<string, string>();
export async function uri(r: Recent): Promise<string | null> {
  const hit = uris.get(r.id);
  if (hit) return hit;
  const b = await bytes(r);
  if (!b) return null;
  const u = `data:${r.mime};base64,${toB64(b)}`;
  uris.set(r.id, u);
  return u;
}

/** Sent again: move to the front and remember the chat. */
export async function touch(id: string, cid: string) {
  const all = await list();
  const r = all.find((x) => x.id === id);
  if (!r) return;
  await save([{ ...r, at: Date.now(), to: r.to.includes(cid) ? r.to : [...r.to, cid] }, ...all.filter((x) => x.id !== id)]);
}

export async function remove(id: string) {
  await dropBlob(id).catch(() => {});
  uris.delete(id);
  await save((await list()).filter((x) => x.id !== id));
}

/** Settings › Privacy › Clear Sent recently; sign-out, account delete and duress wipe. */
export async function clear() {
  for (const r of await list()) await dropBlob(r.id).catch(() => {});
  if (!WEB) {
    const { dir } = await fs().catch(() => ({ dir: null }));
    try {
      if (dir?.exists) dir.delete();
    } catch {
      // ignore: files already removed one by one
    }
  }
  uris.clear();
  await save([]);
}

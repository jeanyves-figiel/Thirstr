// F-01 R-01.7 recovery phrase + sealed backup (#25, option B).
// 12 BIP-39 words → 128-bit entropy → HKDF-SHA256 (salt "thirstr-recovery-v1"):
//   info "signin" → Ed25519 seed (only the public key goes to the server)
//   info "vault"  → AES-256-GCM key for the sealed backup (kept in the Keychain to update it)
// The words and the sign-in key are never stored anywhere.
import { gcm } from '@noble/ciphers/aes.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, platform, saveSession, Session } from '../api/client';
import { concat, fromB64, fromUtf8, hex, rand, toB64, utf8 } from '../chat/bytes';
import { kv } from '../chat/kv';

export const WORDS = wordlist;
const SALT = utf8('thirstr-recovery-v1');
const AAD = utf8('thirstr-vault-v1');
const VAULT_KEY = 'thirstr.recovery.vault';
const HOUR = 3600_000;

const b64u = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type Keys = { publicKey: Uint8Array; secretKey: Uint8Array; vaultKey: Uint8Array };

export function newWords(): string[] {
  return entropyToMnemonic(rand(16), wordlist).split(' ');
}

export const normalize = (words: string[]) => words.map((w) => w.trim().toLowerCase()).filter(Boolean);
export const isWord = (w: string) => wordlist.includes(w.trim().toLowerCase());
export const valid = (words: string[]) => words.length === 12 && validateMnemonic(normalize(words).join(' '), wordlist);
/** Up to 3 list words starting with the prefix (suggestion bar). */
export const suggest = (prefix: string) => {
  const p = prefix.trim().toLowerCase();
  return p ? wordlist.filter((w) => w.startsWith(p)).slice(0, 3) : [];
};

/** Why the typed words can't be used yet (first bad word wins), or null when they can (or aren't all typed). */
export function wordsProblem(words: string[]): { notWord: number } | 'checksum' | null {
  const bad = words.findIndex((w) => w.trim() && !isWord(w));
  if (bad >= 0) return { notWord: bad + 1 };
  if (words.filter((w) => w.trim()).length < 12) return null;
  return valid(words) ? null : 'checksum';
}

export function deriveKeys(words: string[]): Keys {
  const e = mnemonicToEntropy(normalize(words).join(' '), wordlist);
  const seed = hkdf(sha256, e, SALT, utf8('signin'), 32);
  const vaultKey = hkdf(sha256, e, SALT, utf8('vault'), 32);
  return { publicKey: ed25519.getPublicKey(seed), secretKey: seed, vaultKey };
}

/** Three distinct positions (0-based) and 4 shuffled choices each, for the "Quick check". */
export function quiz(words: string[], pick = Math.random): { pos: number; choices: string[] }[] {
  const pos: number[] = [];
  while (pos.length < 3) {
    const p = Math.floor(pick() * 12);
    if (!pos.includes(p)) pos.push(p);
  }
  return pos.map((p) => {
    const set = new Set([words[p]]);
    while (set.size < 4) {
      const w = wordlist[Math.floor(pick() * wordlist.length)];
      if (!words.includes(w)) set.add(w);
    }
    const choices = [...set];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(pick() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return { pos: p, choices };
  });
}

// --- sealed backup

type Backup = { v: 1; albums: unknown; notes: { profile: string; note: unknown }[]; favorites: unknown; friends: unknown };

async function collect(): Promise<Backup> {
  const notes = await Promise.all((await kv.keys('note:')).map(async (k) => ({ profile: k.slice(5), note: await kv.get(k) })));
  return { v: 1, albums: (await kv.get('albums')) ?? [], notes, favorites: (await kv.get('favs')) ?? {}, friends: (await kv.get('friends')) ?? {} };
}

export function seal(key: Uint8Array, data: unknown): Uint8Array {
  const iv = rand(12);
  return concat(iv, gcm(key, iv, AAD).encrypt(utf8(JSON.stringify(data))));
}

export function open<T>(key: Uint8Array, box: Uint8Array): T {
  return JSON.parse(fromUtf8(gcm(key, box.slice(0, 12), AAD).decrypt(box.slice(12)))) as T;
}

const secure = {
  get: (k: string) => (Platform.OS === 'web' ? kv.get<string>(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? kv.set(k, v) : SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY })),
  del: (k: string) => (Platform.OS === 'web' ? kv.set(k, null) : SecureStore.deleteItemAsync(k)),
};

/** The vault key on this phone (recovery phrase on), or null. Chat backup derives from it (R-01.15). */
export async function vaultKey(): Promise<Uint8Array | null> {
  const k = await secure.get(VAULT_KEY);
  return k ? fromB64(k) : null;
}

/** Restore on a phone signed in another way: keep the vault key once it opened the backup. */
export async function keepVaultKey(k: Uint8Array) {
  await secure.set(VAULT_KEY, toB64(k));
}

/** Uploads the backup when it changed and the last upload is ≥ 1 h old (or `force`). */
export async function backupNow(opts: { force?: boolean; now?: number } = {}): Promise<boolean> {
  const k = await secure.get(VAULT_KEY);
  if (!k) return false;
  const now = opts.now ?? Date.now();
  const last = (await kv.get<{ hash: string; at: number }>('recovery:last')) ?? { hash: '', at: 0 };
  if (!opts.force && now - last.at < HOUR) return false;
  const data = await collect();
  const hash = hex(sha256(utf8(JSON.stringify(data))));
  if (!opts.force && hash === last.hash) return false;
  await api('PUT', '/me/recovery/vault', { vault: toB64(seal(fromB64(k), data)) });
  await kv.set('recovery:last', { hash, at: now });
  return true;
}

let running: Promise<unknown> | null = null;
/** App start / foreground: quiet, single-flight, never throws. */
export function backupIfDue() {
  running ??= backupNow()
    .catch(() => false)
    .finally(() => (running = null));
  return running;
}

/** Setup or "Make new words": registers the public key, keeps the vault key, uploads the first backup. */
export async function turnOn(words: string[]) {
  const keys = deriveKeys(words);
  await api('PUT', '/me/recovery', { public_key: b64u(keys.publicKey) });
  await secure.set(VAULT_KEY, toB64(keys.vaultKey));
  await kv.set('recovery:last', null);
  await backupNow({ force: true }).catch(() => false);
}

export async function turnOff() {
  await api('DELETE', '/me/recovery');
  await secure.del(VAULT_KEY);
  await kv.set('recovery:last', null);
}

export type Restored = { albums: number; notes: number; favorites: number; friends: number; backupAt: string | null };

/** Sign in with the words (S-02), then open the sealed backup on this phone. */
export async function signInWithWords(words: string[]): Promise<{ me: Session['account']; restored: Restored | null }> {
  const keys = deriveKeys(words);
  const { challenge_id, challenge } = await api<{ challenge_id: string; challenge: string }>('POST', '/auth/recovery/options', {});
  const sig = ed25519.sign(utf8('thirstr-recovery:' + challenge), keys.secretKey);
  const s = await api<Session>('POST', '/auth/recovery', { challenge_id, public_key: b64u(keys.publicKey), signature: b64u(sig), platform });
  const me = await saveSession(s);
  await secure.set(VAULT_KEY, toB64(keys.vaultKey));
  let restored: Restored | null = null;
  try {
    const { vault, updated_at } = await api<{ vault: string; updated_at: string }>('GET', '/me/recovery/vault');
    const b = open<Backup>(keys.vaultKey, fromB64(vault));
    if (Array.isArray(b.albums) && b.albums.length) await kv.set('albums', b.albums);
    for (const n of b.notes ?? []) await kv.set('note:' + n.profile, n.note);
    await kv.set('favs', b.favorites ?? {});
    await kv.set('friends', b.friends ?? {});
    restored = {
      albums: Array.isArray(b.albums) ? b.albums.length : 0,
      notes: b.notes?.length ?? 0,
      favorites: Object.keys((b.favorites as object) ?? {}).length,
      friends: Object.keys((b.friends as object) ?? {}).length,
      backupAt: updated_at,
    };
  } catch {
    // no backup yet, or it can't be opened: sign-in still worked
  }
  return { me, restored };
}

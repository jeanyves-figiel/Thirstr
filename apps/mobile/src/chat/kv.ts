// Device store (data-model.md › Device-only): SQLCipher database, key in the Keychain.
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { hex, rand } from './bytes';

let db: SQLite.SQLiteDatabase | null = null;

async function open() {
  if (db) return db;
  let key = await SecureStore.getItemAsync('thirstr.dbkey');
  if (!key) {
    key = hex(rand(32));
    await SecureStore.setItemAsync('thirstr.dbkey', key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  }
  const d = await SQLite.openDatabaseAsync('thirstr.db');
  await d.execAsync(`PRAGMA key = "x'${key}'"`);
  // SR-14 (#154): refuse to run on a build without SQLCipher (PRAGMA key would be a silent no-op
  // and everything would be stored in clear).
  const c = await d.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version').catch(() => null);
  if (!c?.cipher_version) {
    await d.closeAsync().catch(() => {});
    throw new Error('encrypted store unavailable');
  }
  await d.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);');
  db = d;
  return d;
}

// SR-15 (#155): prefix reads as a key range (BINARY collation) so the primary-key index is used.
// SQLite's LIKE is case-insensitive and can't use it: every chat open scanned the whole store.
const upper = (prefix: string) => prefix + String.fromCodePoint(0x10ffff);

export const kv = {
  async get<T>(k: string): Promise<T | null> {
    const r = await (await open()).getFirstAsync<{ v: string }>('SELECT v FROM kv WHERE k = ?', k);
    return r ? (JSON.parse(r.v) as T) : null;
  },
  async set(k: string, v: unknown) {
    await (await open()).runAsync('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', k, JSON.stringify(v));
  },
  async del(k: string) {
    await (await open()).runAsync('DELETE FROM kv WHERE k = ?', k);
  },
  async keys(prefix: string): Promise<string[]> {
    const rows = await (await open()).getAllAsync<{ k: string }>('SELECT k FROM kv WHERE k >= ? AND k < ?', prefix, upper(prefix));
    return rows.map((r) => r.k);
  },
  /** All values whose key starts with `prefix`, in one query (per-message rows, R-07.21). */
  async getPrefix<T>(prefix: string): Promise<T[]> {
    const rows = await (await open()).getAllAsync<{ v: string }>('SELECT v FROM kv WHERE k >= ? AND k < ?', prefix, upper(prefix));
    return rows.map((r) => JSON.parse(r.v) as T);
  },
  /**
   * SR-15 (#155): the newest `n` values under `prefix` by their `at` / `seq` fields, sorted in
   * SQLite (no JS parse of the whole chat). Oldest first. Falls back to a full read if the
   * build's SQLite lacks JSON functions.
   */
  async tail<T>(prefix: string, n: number): Promise<T[]> {
    const d = await open();
    const rows = await d
      .getAllAsync<{ v: string }>(
        "SELECT v FROM kv WHERE k >= ? AND k < ? ORDER BY json_extract(v, '$.at') DESC, json_extract(v, '$.seq') DESC LIMIT ?",
        prefix,
        upper(prefix),
        n,
      )
      .catch(() => null);
    if (rows) return rows.map((r) => JSON.parse(r.v) as T).reverse();
    return (await this.getPrefix<T & { at: number; seq?: number }>(prefix)).sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0)).slice(-n);
  },
  async delPrefix(prefix: string) {
    await (await open()).runAsync('DELETE FROM kv WHERE k >= ? AND k < ?', prefix, upper(prefix));
  },
  async wipe() {
    await (await open()).runAsync('DELETE FROM kv');
  },
};

// Bot replacement for the app's device store (apps/mobile/src/chat/kv.ts): one small file per key
// on the bot's private volume, each written atomically. Same interface as the app's kv. Shared by
// every bot in the process: MLS keys are unique (key package hash, group id), bot state is
// prefixed with the bot's handle.
import fs from 'node:fs';
import path from 'node:path';

const dir = () => path.join(process.env.BOT_DATA_DIR ?? './data', 'kv');
const file = (k: string) => path.join(dir(), encodeURIComponent(k));
let ready = false;

function init() {
  if (ready) return;
  fs.mkdirSync(dir(), { recursive: true });
  // v1 (#109) kept everything in one kv.json: split it once.
  const legacy = path.join(process.env.BOT_DATA_DIR ?? './data', 'kv.json');
  if (fs.existsSync(legacy)) {
    try {
      const m = JSON.parse(fs.readFileSync(legacy, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(m)) write(k, v);
    } catch {
      // unreadable: start fresh
    }
    fs.renameSync(legacy, legacy + '.migrated');
  }
  ready = true;
}

/** v1 bot state had no handle prefix; it belonged to "testbot". */
const V1 = ['auth', 'seen', 'pending'];
const legacyKey = (k: string) => V1.includes(k) || k.startsWith('conv:') || k.startsWith('g2p:');

function write(k: string, v: unknown) {
  const key = legacyKey(k) && !ready ? 'testbot:' + k : k;
  const f = file(key);
  fs.writeFileSync(f + '.tmp', JSON.stringify(v));
  fs.renameSync(f + '.tmp', f);
}

function read<T>(k: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file(k), 'utf8')) as T;
  } catch {
    return null;
  }
}

const names = () => fs.readdirSync(dir()).filter((n) => !n.endsWith('.tmp')).map(decodeURIComponent);

export const kv = {
  async get<T>(k: string): Promise<T | null> {
    init();
    return read<T>(k);
  },
  async set(k: string, v: unknown) {
    init();
    write(k, v);
  },
  async del(k: string) {
    init();
    fs.rmSync(file(k), { force: true });
  },
  async keys(prefix: string) {
    init();
    return names().filter((k) => k.startsWith(prefix));
  },
  async getPrefix<T>(prefix: string): Promise<T[]> {
    init();
    return names()
      .filter((k) => k.startsWith(prefix))
      .map((k) => read<T>(k))
      .filter((v): v is T => v !== null);
  },
  async delPrefix(prefix: string) {
    init();
    for (const k of names()) if (k.startsWith(prefix)) fs.rmSync(file(k), { force: true });
  },
  async wipe() {
    init();
    fs.rmSync(dir(), { recursive: true, force: true });
    fs.mkdirSync(dir(), { recursive: true });
  },
};

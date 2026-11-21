import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// F-01 R-01.15 (#146): opt-in chat backup. Incremental segments + tombstones, compaction,
// restore on a fresh phone, wrong key refused. The server is an in-memory fake.
const mockStore = new Map<string, unknown>();
const mockObjects = new Map<string, Uint8Array>();
const mockServer: { manifest: string | null; segs: string[]; pending: Map<string, number> } = { manifest: null, segs: [], pending: new Map() };
const mockPhone: { convs: Record<string, unknown>[]; msgs: Record<string, Record<string, unknown>[]>; imported: unknown[] } = { convs: [], msgs: {}, imported: [] };
let mockVaultKey: Uint8Array | null = new Uint8Array(32).fill(7);
let mockN = 0;
let mockLoaded: Promise<void> = Promise.resolve();
const mockMedia = new Map<string, Uint8Array>();

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/app/dataSaver', () => ({ unmetered: () => true }));
jest.mock('../src/auth/recovery', () => ({
  vaultKey: async () => mockVaultKey,
  keepVaultKey: async (k: Uint8Array) => void (mockVaultKey = k),
}));
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void (v === null ? mockStore.delete(k) : mockStore.set(k, v)),
  },
}));
jest.mock('../src/chat/mediaCache', () => ({
  sizeOf: async (b: string) => mockMedia.get(b)?.length ?? 0,
  get: async (b: string) => mockMedia.get(b) ?? null,
  put: async (b: string, ct: Uint8Array) => void mockMedia.set(b, ct),
}));
jest.mock('../src/chat/engine', () => ({
  TTL_S: { '24h': 86400, '7d': 604800, never: null },
  getConvs: () => mockPhone.convs,
  loadedConvs: () => mockLoaded,
  messages: async (cid: string) => mockPhone.msgs[cid] ?? [],
  importHistory: async (cs: unknown[], rows: Record<string, unknown[]>, tomb: Record<string, string[]>) => {
    mockPhone.imported.push({ cs, rows, tomb });
    return { chats: cs.length, messages: Object.values(rows).reduce((n, l) => n + l.length, 0) };
  },
}));
jest.mock('../src/api/client', () => ({
  ApiError: class extends Error {
    status = 0;
  },
  api: async (m: string, path: string, body?: Record<string, unknown>) => {
    if (path === '/me/backup/segments') {
      const id = `s${++mockN}`;
      mockServer.pending.set(id, body!.size as number);
      return { id, upload_url: `https://s3/${id}` };
    }
    if (path === '/me/backup/manifest' && m === 'PUT') {
      const ids = body!.segments as string[];
      for (const id of ids) if (!mockObjects.has(id)) throw new Error('segment_missing');
      mockServer.manifest = body!.manifest as string;
      mockServer.segs = ids;
      return { bytes: ids.reduce((n, id) => n + mockObjects.get(id)!.length, 0), updated_at: 'now' };
    }
    if (path === '/me/backup/manifest' && m === 'GET') return { manifest: mockServer.manifest, segments: mockServer.segs.map((id) => ({ id, size: 1, url: `https://s3/${id}` })) };
    if (path === '/me/backup' && m === 'DELETE') {
      mockServer.manifest = null;
      mockServer.segs = [];
      return {};
    }
    return {};
  },
}));

(globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; body?: Uint8Array }) => {
  const id = url.split('/').pop()!;
  if (init?.method === 'PUT') {
    mockObjects.set(id, init.body!);
    return { ok: true };
  }
  const b = mockObjects.get(id)!;
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

import * as B from '../src/chat/backup';

const conv = (id: string, ttl = 'never') => ({ id, me: 'p1', peer: 'p2', groups: [], name: id, photo: null, verified: true, lastAt: 1, last: '', unread: 0, theyWrote: true, iWrote: true, ttl });
const msg = (id: string, extra: object = {}) => ({ id, from: 'them', at: 1, p: { t: 'text', text: 'hi ' + id }, status: 'read', raw: 'secret', ...extra });

beforeEach(() => {
  mockStore.clear();
  mockObjects.clear();
  mockServer.manifest = null;
  mockServer.segs = [];
  mockPhone.imported = [];
  mockVaultKey = new Uint8Array(32).fill(7);
  mockMedia.clear();
  mockPhone.convs = [conv('a'), conv('b'), conv('quick', '24h')];
  mockPhone.msgs = {
    a: [msg('a1'), msg('a2'), msg('once', { p: { t: 'media', media: { blob: 'x', key: 'k', iv: 'i', mime: 'image/jpeg', once: true } } })],
    b: [msg('b1')],
    quick: [msg('q1')],
  };
});

describe('#146 chat backup (R-01.15)', () => {
  it('seals segments the server cannot read; skips view-once, short-timer chats and franking plaintext', async () => {
    const r = await B.turnOn();
    expect(r?.rows).toBe(3);
    expect(mockServer.segs).toHaveLength(1);
    const box = mockObjects.get(mockServer.segs[0])!;
    expect(new TextDecoder().decode(box)).not.toContain('hi a1');
    const seg = B.openBox<{ rows: Record<string, { id: string; raw?: string }[]> }>(B.chatKey(mockVaultKey!), box);
    expect(Object.keys(seg.rows).sort()).toEqual(['a', 'b']);
    expect(seg.rows.a.map((m) => m.id)).toEqual(['a1', 'a2']);
    expect(seg.rows.a[0].raw).toBeUndefined();
  });

  it('adds only new rows and tombstones, then restores on a fresh phone', async () => {
    mockPhone.msgs.b = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => msg(id));
    await B.turnOn();
    mockPhone.msgs.a = [mockPhone.msgs.a[1], msg('a3')]; // a1 deleted, a3 new
    const r = await B.backupNow();
    expect(r?.rows).toBe(1);
    expect(mockServer.segs).toHaveLength(2);
    const nothing = await B.backupNow();
    expect(nothing?.rows).toBe(0);
    expect(mockServer.segs).toHaveLength(2);

    const got = await B.restore();
    expect(got.messages).toBe(8); // a1, a2, b1–b5, then a3
    const last = mockPhone.imported[1] as { rows: Record<string, { id: string }[]>; tomb: Record<string, string[]> };
    expect(last.rows.a.map((m) => m.id)).toEqual(['a3']);
    expect(last.tomb.a).toEqual(['a1']);
  });

  it('compacts into fresh segments when tombstones pass 30 %', async () => {
    await B.turnOn();
    mockPhone.msgs.a = [];
    await B.backupNow(); // 2 of 3 rows tombstoned
    await B.backupNow();
    expect(mockServer.segs).toHaveLength(1);
    const seg = B.openBox<{ rows: Record<string, unknown[]>; tomb: object }>(B.chatKey(mockVaultKey!), mockObjects.get(mockServer.segs[0])!);
    expect(Object.keys(seg.rows)).toEqual(['b']);
    expect(seg.tomb).toEqual({});
  });

  it('a wrong key cannot open the backup', async () => {
    await B.turnOn();
    mockVaultKey = new Uint8Array(32).fill(9);
    await expect(B.restore()).rejects.toBeInstanceOf(B.WrongWords);
  });

  it('#261: typed words are kept only when they open the backup', async () => {
    await B.turnOn();
    const right = mockVaultKey!;
    mockVaultKey = null;
    await expect(B.unlock(new Uint8Array(32).fill(9))).rejects.toBeInstanceOf(B.WrongWords);
    expect(mockVaultKey).toBeNull();
    await B.unlock(right);
    expect(mockVaultKey).toEqual(right);
    expect((await B.restore()).messages).toBe(3);
  });

  it('waits for the chat list before a run, so an early start-up run tombstones nothing', async () => {
    await B.turnOn();
    let release = () => {};
    mockLoaded = new Promise<void>((r) => (release = r));
    const real = mockPhone.convs;
    mockPhone.convs = []; // engine not started yet
    const run = B.backupNow();
    await new Promise((r) => setTimeout(r, 10));
    mockPhone.convs = real; // start() loaded the list
    release();
    expect((await run)?.rows).toBe(0);
    expect(mockServer.segs).toHaveLength(1);
    mockLoaded = Promise.resolve();
  });

  it('#259: photos and videos go in sealed parts when switched on, and come back on a fresh phone', async () => {
    const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    mockMedia.set('p1', big);
    mockPhone.msgs.b.push(msg('pic', { at: 5, p: { t: 'media', media: { blob: 'p1', key: 'k', iv: 'i', mime: 'image/jpeg' } } }));
    await B.turnOn();
    expect(mockServer.segs).toHaveLength(1); // media off by default
    await B.setMedia(true);
    await B.backupNow();
    expect(mockServer.segs).toHaveLength(4); // rows + index + 2 parts
    const head = big.slice(0, 64).join(',');
    for (const id of mockServer.segs) expect(mockObjects.get(id)!.slice(12, 76).join(',')).not.toBe(head); // sealed, not plain

    mockMedia.clear();
    const got = await B.restore();
    expect(got.media).toBe(1);
    expect(mockMedia.get('p1')).toEqual(big);

    await B.setMedia(false);
    await B.backupNow();
    expect(mockServer.segs).toHaveLength(1); // parts and index no longer listed (server purges)
  });

  it('#259: newest media first within the room left', () => {
    const w = (blob: string, at: number, size: number) => ({ blob, at, size });
    expect(B.pickMedia([w('old', 1, 60), w('new', 3, 60), w('mid', 2, 30)], 160).map((x) => x.blob)).toEqual(['new', 'mid']);
  });

  it('daily on Wi-Fi only when on', async () => {
    await B.backupIfDue();
    expect(mockServer.segs).toHaveLength(0);
    await B.turnOn();
    const n = mockN;
    await B.backupIfDue();
    expect(mockN).toBe(n); // ran less than a day ago
    await B.turnOff();
    expect(mockServer.manifest).toBeNull();
    expect((await B.prefs()).on).toBe(false);
  });
});

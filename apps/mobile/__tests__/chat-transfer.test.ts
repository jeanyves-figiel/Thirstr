import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// F-01 R-01.14 (#146): chat history to a new phone. Both phones run in one process against an
// in-memory fake of the relay; the "server" only ever sees sealed chunks.
type T = { id: string; sent: number; acked: number; bytes: number; total: number | null; chunks: Map<number, number> };
const mockSrv: { t: T | null; objects: Map<string, Uint8Array> } = { t: null, objects: new Map() };
const mockOld: { convs: Record<string, unknown>[]; msgs: Record<string, Record<string, unknown>[]>; media: Map<string, Uint8Array> } = { convs: [], msgs: {}, media: new Map() };
const mockNew: { imported: { cs: { id: string }[]; rows: Record<string, { id: string; raw?: string }[]> }[]; media: Map<string, Uint8Array> } = { imported: [], media: new Map() };

jest.mock('../src/chat/engine', () => ({
  getConvs: () => mockOld.convs,
  messages: async (cid: string) => mockOld.msgs[cid] ?? [],
  expiresAt: (_c: unknown, m: { exp?: number }) => m.exp ?? null,
  importHistory: async (cs: { id: string }[], rows: Record<string, { id: string }[]>) => {
    mockNew.imported.push({ cs, rows });
    return { chats: cs.length, messages: Object.values(rows).reduce((n, l) => n + l.length, 0) };
  },
}));
jest.mock('../src/chat/mediaCache', () => ({
  sizeOf: async (b: string) => mockOld.media.get(b)?.length ?? 0,
  get: async (b: string) => mockOld.media.get(b) ?? null,
  put: async (b: string, ct: Uint8Array) => void mockNew.media.set(b, ct),
}));
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const nf = () => new ApiError(404, 'not_found');
  return {
    ApiError,
    api: async (m: string, path: string, body?: Record<string, unknown>) => {
      const t = mockSrv.t;
      if (path === '/devices/transfer' && m === 'POST') {
        mockSrv.t = { id: 'x1', sent: 0, acked: 0, bytes: 0, total: null, chunks: new Map() };
        return { id: 'x1' };
      }
      if (path === '/devices/transfer/incoming') {
        if (!t || (t.total != null && t.acked >= t.total)) throw nf();
        return { ...t, estimate: 1, chunks: [...t.chunks.keys()].map((n) => ({ n, url: `https://s3/${n}` })) };
      }
      if (!t) throw nf();
      if (path.endsWith('/chunks')) return { upload_url: `https://s3/${body!.n}` };
      const ready = path.match(/chunks\/(\d+)\/ready$/);
      if (ready) {
        const n = Number(ready[1]);
        t.chunks.set(n, mockSrv.objects.get(String(n))!.length);
        t.sent++;
        t.bytes += t.chunks.get(n)!;
        return {};
      }
      if (path.endsWith('/ack')) {
        for (const n of body!.n as number[]) if (t.chunks.delete(n)) t.acked++;
        return {};
      }
      if (path.endsWith('/done')) {
        t.total = body!.total as number;
        return {};
      }
      if (m === 'DELETE') {
        mockSrv.t = null;
        return {};
      }
      return t;
    },
  };
});

(globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; body?: Uint8Array }) => {
  const id = url.split('/').pop()!;
  if (init?.method === 'PUT') {
    mockSrv.objects.set(id, init.body!);
    return { ok: true };
  }
  const b = mockSrv.objects.get(id)!;
  return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};

import * as X from '../src/chat/transfer';

const conv = (id: string) => ({ id, name: id, ttl: 'never' });
const msg = (id: string, extra: object = {}) => ({ id, from: 'them', at: Date.now() - 1000, p: { t: 'text', text: 'hi ' + id }, status: 'read', raw: 'secret', ...extra });

beforeEach(() => {
  X._reset();
  mockSrv.t = null;
  mockSrv.objects.clear();
  mockNew.imported = [];
  mockNew.media.clear();
  mockOld.media = new Map([['b1', new Uint8Array(5 * 1024 * 1024).fill(3)]]);
  mockOld.convs = [conv('a'), conv('b')];
  mockOld.msgs = {
    a: [
      msg('a1'),
      msg('old', { at: Date.now() - 400 * 86_400_000 }),
      msg('once', { p: { t: 'media', media: { blob: 'x', once: true } } }),
      msg('soon', { exp: Date.now() + 60_000 }),
      msg('pic', { p: { t: 'media', media: { blob: 'b1' } } }),
    ],
    b: [msg('b1'), msg('fail', { status: 'failed' })],
  };
});

describe('#146 phone-to-phone transfer (R-01.14)', () => {
  it('both phones show the same code; a swapped key shows another', () => {
    const o = X.newKeys();
    const n = X.newKeys();
    expect(X.matchCode(o.pub, n.pub)).toMatch(/^\d{3} \d{3}$/);
    expect(X.matchCode(o.pub, n.pub)).not.toBe(X.matchCode(o.pub, X.newKeys().pub));
    expect(X.sessionKey(o, n.pub)).toEqual(X.sessionKey(n, o.pub));
  });

  it('plans only what should move; "last 12 months" drops older rows', async () => {
    const all = X.estimate(await X.plan('all'));
    expect(all.messages).toBe(4); // a1, old, pic, b1
    expect(all.media).toBe(1);
    expect(X.estimate(await X.plan('year')).messages).toBe(3);
  });

  it('moves chats and media sealed, in order, and the relay keeps nothing', async () => {
    const o = X.newKeys();
    const n = X.newKeys();
    X.expect(n, o.pub);
    const states: string[] = [];
    const ctl = X.send({ linkCode: 'ABCD1234', keys: o, peerPub: n.pub, plan: await X.plan('all'), withMedia: true, onProgress: (p) => states.push(p.state) });
    const got = await X.receive(() => {}, () => true);
    await ctl.done;

    expect(states.at(-1)).toBe('done');
    expect(got?.messages).toBe(4);
    expect(got?.media).toBe(1);
    expect(mockNew.media.get('b1')).toEqual(mockOld.media.get('b1'));
    const ids = mockNew.imported.flatMap((i) => Object.values(i.rows).flat());
    expect(ids.map((m) => m.id)).toEqual(['a1', 'old', 'pic', 'b1']);
    expect(ids.every((m) => m.raw === undefined)).toBe(true);
    expect(mockSrv.t?.chunks.size).toBe(0);
    for (const box of mockSrv.objects.values()) expect(new TextDecoder().decode(box)).not.toContain('hi a1');
    expect(X.expecting()).toBe(false);
  });

  it('a wrong key cannot open a chunk', async () => {
    const o = X.newKeys();
    const p = await X.plan('all');
    const c = (await X.chunks(p, false).next()).value!;
    const box = X.seal(X.sessionKey(o, X.newKeys().pub), 'x1', 0, c);
    expect(() => X.open(X.sessionKey(o, X.newKeys().pub), 'x1', 0, box)).toThrow();
  });
});

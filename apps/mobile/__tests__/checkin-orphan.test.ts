import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// #127, R-13.21: the server still runs a check-in this phone lost (reinstall, wipe).
const mockStore = new Map<string, unknown>();
const mockCalls: { method: string; path: string; body?: unknown }[] = [];
let mockServer: null | { due_at: string; extensions: number } = null;
let mockDeleteStatus = 204;
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void mockStore.set(k, v),
    del: async (k: string) => void mockStore.delete(k),
  },
}));
jest.mock('../src/explore/location', () => ({ currentPosition: async () => null }));
jest.mock('../src/api/client', () => ({
  api: async (method: string, path: string, body?: unknown) => {
    mockCalls.push({ method, path, body });
    if (path === '/trusted') return { contacts: [{ id: 'r1', accepted: true, push: true }] };
    if (path === '/checkin' && method === 'GET') return { checkin: mockServer };
    if (path === '/checkin' && method === 'DELETE') {
      if (mockDeleteStatus !== 204) throw Object.assign(new Error('x'), { status: mockDeleteStatus });
      mockServer = null;
      return undefined;
    }
    return {};
  },
}));

import * as S from '../src/safety/safety';

const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const due = '2026-11-21T22:00:00.000Z';

beforeEach(() => {
  mockStore.clear();
  mockCalls.length = 0;
  mockServer = { due_at: due, extensions: 0 };
  mockDeleteStatus = 204;
});

describe('#127 orphan check-in (R-13.21)', () => {
  it('is found when the server runs one and the phone has none', async () => {
    expect(await S.orphanCheckin()).toEqual({ due, ext: 0 });
  });

  it('is not an orphan when the phone has its copy', async () => {
    mockStore.set('safety:checkin', { token: 't', due, ext: 0, name: 'Me', live: false });
    expect(await S.orphanCheckin()).toBeNull();
    expect(mockCalls.some((c) => c.path === '/checkin')).toBe(false);
  });

  it('ends by account with ok envelopes for contacts this phone still knows', async () => {
    mockStore.set('safety:contacts', [{ id: 'r1', rid: 'x', key, label: 'A', accepted: true }]);
    await S.endOrphan('Me');
    const del = mockCalls.find((c) => c.method === 'DELETE');
    expect(del?.path).toBe('/checkin');
    const oks = (del?.body as { oks: { relay: string; ciphertext: string }[] }).oks;
    expect(oks.map((o) => o.relay)).toEqual(['r1']);
    expect((await S.open(key, oks[0].ciphertext)).k).toBe('ok');
    expect(await S.orphanCheckin()).toBeNull();
  });

  it('with no contact keys left still ends it (no envelopes); 404 = already gone', async () => {
    await S.endOrphan('Me');
    expect((mockCalls.find((c) => c.method === 'DELETE')?.body as { oks: unknown[] }).oks).toEqual([]);
    mockDeleteStatus = 404;
    await expect(S.endOrphan('Me')).resolves.toBeUndefined();
  });

  it('other failures surface so the screen does not claim "All good"', async () => {
    mockDeleteStatus = 500;
    await expect(S.endOrphan('Me')).rejects.toBeTruthy();
  });
});

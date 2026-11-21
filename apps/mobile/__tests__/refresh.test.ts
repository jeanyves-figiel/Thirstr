// #116: parallel 401s must share one /auth/refresh call (the server revokes the device when a
// spent refresh token comes back), and only a definitive 401/403 ends the session.
import { beforeEach, expect, jest, test } from '@jest/globals';

const mockKc = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockKc.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockKc.set(k, v),
  deleteItemAsync: async (k: string) => void mockKc.delete(k),
}));

import { api, ApiError } from '../src/api/client';

type Call = { url: string; auth?: string; body?: string };
let calls: Call[];
let refreshStatus: number;

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

beforeEach(() => {
  mockKc.clear();
  mockKc.set('thirstr.access', 'a1');
  mockKc.set('thirstr.refresh', 'r1');
  calls = [];
  refreshStatus = 200;
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: h.authorization, body: init.body as string });
    if (url.endsWith('/auth/refresh')) {
      await new Promise((r) => setTimeout(r, 20));
      if (refreshStatus !== 200) return json(refreshStatus, { error: { code: 'x' } });
      return json(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 900, account: {} });
    }
    return h.authorization === 'Bearer a2' ? json(200, { ok: url }) : json(401, { error: { code: 'unauthorized' } });
  });
});

test('five parallel 401s trigger exactly one refresh, all retry with the new token', async () => {
  const r = await Promise.all(['/a', '/b', '/c', '/d', '/e'].map((p) => api<{ ok: string }>('GET', p)));
  expect(r.map((x) => x.ok.split('/v1')[1])).toEqual(['/a', '/b', '/c', '/d', '/e']);
  expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  expect(mockKc.get('thirstr.refresh')).toBe('r2');
});

test('a 409 refresh race or 5xx keeps the session', async () => {
  for (const s of [409, 503]) {
    refreshStatus = s;
    await expect(api('GET', '/a')).rejects.toBeInstanceOf(ApiError);
    expect(mockKc.get('thirstr.refresh')).toBe('r1');
  }
});

test('offline refresh keeps the session', async () => {
  const f = globalThis.fetch as jest.Mock<typeof fetch>;
  const base = f.getMockImplementation()!;
  f.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/auth/refresh')) throw new TypeError('Network request failed');
    return base(url, init);
  });
  await expect(api('GET', '/a')).rejects.toBeInstanceOf(ApiError);
  expect(mockKc.get('thirstr.refresh')).toBe('r1');
});

test('a definitive 401 on refresh signs out', async () => {
  refreshStatus = 401;
  await expect(api('GET', '/a')).rejects.toBeInstanceOf(ApiError);
  expect(mockKc.has('thirstr.refresh')).toBe(false);
});

// SR-04 (#144): sign-ins carry this install's previous device so the server can resume it.
import { beforeEach, expect, jest, test } from '@jest/globals';

const mockKc = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockKc.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockKc.set(k, v),
  deleteItemAsync: async (k: string) => void mockKc.delete(k),
}));

import { api, clearSession, saveSession } from '../src/api/client';

let seen: Record<string, string>[];
beforeEach(() => {
  mockKc.clear();
  seen = [];
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (_url: string, init: RequestInit) => {
    seen.push((init.headers ?? {}) as Record<string, string>);
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
});

test('device id + secret from a sign-in are kept and sent on the next sign-in only', async () => {
  await saveSession({ access_token: 'a', refresh_token: 'r', expires_in: 900, account: {} as never, device_id: 'd1', device_secret: 's1' });
  await clearSession(); // signed out by the server: the device secret stays
  await api('POST', '/auth/oidc', {});
  expect(seen[0]['x-thirstr-device']).toBe('d1');
  expect(seen[0]['x-thirstr-device-secret']).toBe('s1');
  await api('GET', '/me');
  expect(seen[1]['x-thirstr-device']).toBeUndefined();
});

test('a refresh session without device fields keeps the stored device', async () => {
  await saveSession({ access_token: 'a', refresh_token: 'r', expires_in: 900, account: {} as never, device_id: 'd1', device_secret: 's1' });
  await saveSession({ access_token: 'a2', refresh_token: 'r2', expires_in: 900, account: {} as never });
  expect(mockKc.get('thirstr.device.secret')).toBe('s1');
});

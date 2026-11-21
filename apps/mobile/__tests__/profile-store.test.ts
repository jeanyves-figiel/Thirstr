// SR-16 (#156) opened profiles kept 24 h in the encrypted store.
import { expect, jest, test } from '@jest/globals';

const mockStore = new Map<string, unknown>();
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void mockStore.set(k, JSON.parse(JSON.stringify(v))),
    del: async (k: string) => void mockStore.delete(k),
    keys: async (p: string) => [...mockStore.keys()].filter((k) => k.startsWith(p)),
  },
}));
jest.mock('../src/api/client', () => ({ api: jest.fn(), ApiError: class extends Error {} }));

import type { ProfileView } from '../src/api/types';
import { pruneStored, storedProfile, storeProfile } from '../src/profile/profileCache';

const pv = (id: string) => ({ id, photos: [] }) as unknown as ProfileView;

test('stored per mode/trip, expires after 24 h', async () => {
  await storeProfile(pv('a'), 'hookup', undefined, 1000);
  expect((await storedProfile('a', 'hookup', undefined, 1000 + 3600_000))?.id).toBe('a');
  expect(await storedProfile('a', 'friends', undefined, 1000)).toBeNull();
  expect(await storedProfile('a', 'hookup', undefined, 1000 + 25 * 3600_000)).toBeNull();
});

test('prune keeps the 200 newest', async () => {
  mockStore.clear();
  for (let i = 0; i < 210; i++) await storeProfile(pv('p' + i), 'hookup', undefined, 10_000 + i);
  await pruneStored(10_000 + 300);
  expect([...mockStore.keys()]).toHaveLength(200);
  expect(await storedProfile('p0', 'hookup', undefined, 10_300)).toBeNull();
  expect(await storedProfile('p209', 'hookup', undefined, 10_300)).not.toBeNull();
});

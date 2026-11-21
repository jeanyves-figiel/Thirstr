// SR-16 (#156) Explore snapshot in the encrypted store.
import { expect, jest, test } from '@jest/globals';

const mockStore = new Map<string, unknown>();
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void mockStore.set(k, JSON.parse(JSON.stringify(v))),
    del: async (k: string) => void mockStore.delete(k),
  },
}));

import type { Card } from '../src/api/types';
import { readSnapshot, saveSnapshot, snapshotSig } from '../src/explore/snapshot';

const card = (i: number) => ({ id: 'p' + i }) as unknown as Card;
const sig = snapshotSig({ intents: ['hookup'], filters: {}, x: { trip: null } });

test('same settings within 24 h get the snapshot, capped at 60 cards', async () => {
  const t0 = 1_000_000;
  await saveSnapshot(sig, Array.from({ length: 80 }, (_, i) => card(i)), [card(1)], t0);
  const s = await readSnapshot(sig, t0 + 3600_000);
  expect(s?.items).toHaveLength(60);
  expect(s?.tray).toHaveLength(1);
  expect(await readSnapshot(sig, t0 + 25 * 3600_000)).toBeNull();
});

test('other filters or trip never see it', async () => {
  await saveSnapshot(sig, [card(1)], []);
  expect(await readSnapshot(snapshotSig({ intents: ['hookup'], filters: {}, x: { trip: 't1' } }))).toBeNull();
});

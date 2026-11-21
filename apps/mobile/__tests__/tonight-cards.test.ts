// #210 hidden Tonight items: device-only, forgotten when the item ends.
import { describe, expect, jest, test } from '@jest/globals';
import { hideItem, prune, unhideItem } from '../src/scene/hiddenItems';
import { privateStore } from '../src/app/privateStore';
jest.mock('../src/app/privateStore', () => ({ privateStore: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));

describe('hidden plans and parties', () => {
  test('prune drops ended items', () => {
    expect(prune({ a: 100, b: 300 }, 200)).toEqual({ b: 300 });
  });
  test('hide keeps the item at least 1 h, stored encrypted, undo removes it', () => {
    const now = Date.now();
    hideItem('p1', now - 1000);
    const saved = JSON.parse((privateStore.setItem as jest.Mock).mock.calls.at(-1)?.[1] as string) as Record<string, number>;
    expect(saved.p1).toBeGreaterThanOrEqual(now + 3600e3 - 5);
    unhideItem('p1');
    const after = JSON.parse((privateStore.setItem as jest.Mock).mock.calls.at(-1)?.[1] as string) as Record<string, number>;
    expect(after.p1).toBeUndefined();
  });
});

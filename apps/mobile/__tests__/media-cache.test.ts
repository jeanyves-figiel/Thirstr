// SR-05 (#145): chat media stays on the phone (as ciphertext) after the first download.
import { beforeEach, expect, jest, test } from '@jest/globals';

const mockFiles = new Map<string, Uint8Array>();
const mockKv = new Map<string, unknown>();
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => (mockKv.has(k) ? JSON.parse(JSON.stringify(mockKv.get(k))) : null),
    set: async (k: string, v: unknown) => void mockKv.set(k, v),
  },
}));
jest.mock('expo-file-system', () => {
  class Directory {
    path: string;
    constructor(_base: unknown, name: string) {
      this.path = name;
    }
    get exists() {
      return true;
    }
    create() {}
    delete() {
      for (const k of [...mockFiles.keys()]) if (k.startsWith(this.path + '/')) mockFiles.delete(k);
    }
  }
  class File {
    path: string;
    constructor(d: { path: string }, name: string) {
      this.path = d.path + '/' + name;
    }
    get exists() {
      return mockFiles.has(this.path);
    }
    create() {
      mockFiles.set(this.path, new Uint8Array());
    }
    write(b: Uint8Array) {
      mockFiles.set(this.path, b);
    }
    bytes() {
      return mockFiles.get(this.path)!;
    }
    delete() {
      mockFiles.delete(this.path);
    }
  }
  return { Directory, File, Paths: { document: {} } };
});

import * as C from '../src/chat/mediaCache';

beforeEach(async () => {
  await C.clear();
  mockKv.clear();
});

test('ciphertext is kept and read back; view-once is never stored', async () => {
  await C.put('b1', new Uint8Array([1, 2, 3]));
  expect(Array.from((await C.get('b1'))!)).toEqual([1, 2, 3]);
  await C.put('b2', new Uint8Array([9]), { once: true });
  expect(await C.get('b2')).toBeNull();
});

test('sender expiry drops the file', async () => {
  await C.put('b3', new Uint8Array([1]), { exp: Date.now() - 1 });
  expect(await C.get('b3')).toBeNull();
  expect([...mockFiles.keys()].some((k) => k.includes('b3'))).toBe(false);
});

test('least recently used goes first over the cap', async () => {
  const big = new Uint8Array(C.MAX_BYTES / 2 + 1);
  await C.put('aa', big);
  await C.put('bb', big);
  expect(await C.get('aa')).toBeNull();
  expect(await C.get('bb')).not.toBeNull();
});

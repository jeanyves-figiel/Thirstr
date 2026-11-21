// SR-14 (#154): personal values live in the encrypted store; old plain AsyncStorage copies move
// over once and are deleted.
import { expect, jest, test } from '@jest/globals';

const mockKv = new Map<string, unknown>();
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => (mockKv.has(k) ? mockKv.get(k) : null),
    set: async (k: string, v: unknown) => void mockKv.set(k, v),
    del: async (k: string) => void mockKv.delete(k),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { privateStore } from '../src/app/privateStore';

test('a value from an older build moves to the encrypted store and leaves AsyncStorage', async () => {
  await AsyncStorage.setItem('thirstr.localFields.p1', '{"hiv":"undetectable"}');
  expect(await privateStore.getItem('thirstr.localFields.p1')).toBe('{"hiv":"undetectable"}');
  expect(await AsyncStorage.getItem('thirstr.localFields.p1')).toBeNull();
  expect(mockKv.get('as:thirstr.localFields.p1')).toBe('{"hiv":"undetectable"}');
});

test('writes never touch plain AsyncStorage', async () => {
  await privateStore.setItem('k', 'v');
  expect(await AsyncStorage.getItem('k')).toBeNull();
  expect(await privateStore.getItem('k')).toBe('v');
  await privateStore.removeItem('k');
  expect(await privateStore.getItem('k')).toBeNull();
});

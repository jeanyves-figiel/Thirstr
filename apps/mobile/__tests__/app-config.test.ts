// EN-13 (#172) flags / kill switches, EN-14 (#173) forced update.
import { beforeEach, expect, jest, test } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockBuild: string | null = '120';
jest.mock('expo-application', () => ({
  get nativeBuildVersion() {
    return mockBuild;
  },
}));

import * as C from '../src/app/config';

const cfg = (over: Partial<C.AppConfig> = {}): C.AppConfig => ({
  min_build: { ios: 0, android: 0 },
  upgrade_required: false,
  store_url: { ios: 'https://apps.apple.com/x', android: 'https://play.google.com/x' },
  flags: { video_check: true },
  ...over,
});
const fakeFetch = (body: C.AppConfig) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

beforeEach(() => {
  C._reset();
  mockBuild = '120';
});

test('flags default on, kill switch turns one off', async () => {
  expect(C.flag('video_check')).toBe(true);
  await C.refreshConfig(fakeFetch(cfg({ flags: { video_check: false } })));
  expect(C.flag('video_check')).toBe(false);
  expect(C.flag('unknown')).toBe(true);
});

test('build below the minimum forces the update screen; header carries the build', async () => {
  expect(C.clientHeaders()).toEqual({ 'x-thirstr-build': '120' });
  await C.refreshConfig(fakeFetch(cfg({ min_build: { ios: 121, android: 121 } })));
  expect(C.upgradeRequired()).toBe(true);
  expect(C.storeUrl()).toMatch(/^https:\/\//);
});

test('a 426 from any call forces the update screen; offline keeps the last config', async () => {
  C.markUpgradeRequired();
  expect(C.upgradeRequired()).toBe(true);
  C._reset();
  await C.refreshConfig((async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch);
  expect(C.upgradeRequired()).toBe(false);
});

test('no native build (web/dev): no header, never forced by min build', async () => {
  mockBuild = null;
  expect(C.clientHeaders()).toEqual({});
  await C.refreshConfig(fakeFetch(cfg({ min_build: { ios: 999, android: 999 } })));
  expect(C.upgradeRequired()).toBe(false);
});

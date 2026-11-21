// EN-05 (#164) crash / error reports.
import { beforeEach, expect, jest, test } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-application', () => ({ nativeBuildVersion: '130' }));

import * as Crash from '../src/app/crash';

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let online = true;

beforeEach(async () => {
  Crash._reset();
  calls = [];
  online = true;
  await AsyncStorage.clear();
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    if (!online) throw new Error('offline');
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  }) as unknown as typeof fetch;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

test('non-fatal error is sent once per message, anonymous', async () => {
  Crash.reportError(new TypeError('x is undefined'));
  Crash.reportError(new TypeError('x is undefined'));
  await flush();
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toMatch(/\/v1\/client\/errors$/);
  expect(calls[0].body).toMatchObject({ build: 130, fatal: false, message: 'TypeError: x is undefined' });
  expect(Object.keys(calls[0].body).sort()).toEqual(['build', 'fatal', 'message', 'platform', 'stack']);
});

test('fatal error is queued, then sent with the session ping on next start', async () => {
  await Crash.reportError(new Error('boom'), true);
  expect(calls).toHaveLength(0);
  Crash._reset();
  await Crash.flushCrashes();
  expect(calls.map((c) => c.url.split('/v1')[1])).toEqual(['/client/errors', '/client/sessions']);
  expect(calls[0].body).toMatchObject({ fatal: true, message: 'Error: boom' });
  expect(await AsyncStorage.getItem('thirstr.crashQueue')).toBe('[]');
});

test('queued report stays when offline', async () => {
  await Crash.reportError(new Error('boom'), true);
  online = false;
  await Crash.flushCrashes();
  expect(JSON.parse((await AsyncStorage.getItem('thirstr.crashQueue')) ?? '[]')).toHaveLength(1);
});

test('at most 20 reports per run', async () => {
  for (let i = 0; i < 30; i++) Crash.reportError(new Error('e' + i));
  await flush();
  expect(calls).toHaveLength(20);
});

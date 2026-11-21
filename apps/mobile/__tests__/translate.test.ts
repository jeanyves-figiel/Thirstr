// #106 on-device chat translation (F-07 R-07.25–R-07.31, AC-07.11–AC-07.14) + language filter removal.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/client', () => ({ api: jest.fn() }));

const mockMem = new Map<string, unknown>();
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => (mockMem.has(k) ? JSON.parse(JSON.stringify(mockMem.get(k))) : null),
    set: async (k: string, v: unknown) => void mockMem.set(k, v),
    del: async (k: string) => void mockMem.delete(k),
    keys: async (p: string) => [...mockMem.keys()].filter((k) => k.startsWith(p)),
    getPrefix: async (p: string) => [...mockMem.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => v),
    delPrefix: async (p: string) => [...mockMem.keys()].filter((k) => k.startsWith(p)).forEach((k) => mockMem.delete(k)),
    wipe: async () => mockMem.clear(),
  },
}));

const mockStatus = jest.fn<(f: string, t: string) => Promise<'installed' | 'supported' | 'unsupported'>>();
const mockTranslate = jest.fn<(texts: string[], f: string, t: string) => Promise<string[]>>();
const mockDetect = jest.fn<(t: string) => Promise<{ lang?: string; p?: number }>>();
jest.mock('../modules/thirstr-translate', () => ({
  native: {
    supported: () => true,
    detect: (t: string) => mockDetect(t),
    status: (f: string, t: string) => mockStatus(f, t),
    translate: (x: string[], f: string, t: string) => mockTranslate(x, f, t),
  },
}));

import { api } from '../src/api/client';
import * as store from '../src/chat/store';
import { _reset, modeFor, plan, translateMessage, worthTranslating } from '../src/chat/translate';
import { restoreFilters } from '../src/explore/explore';
import { txEn } from '../src/i18n/app';
import { de } from '../src/i18n/de';
import { fr } from '../src/i18n/fr';
import { trDe, trEn, trFr } from '../src/i18n/translate';
import { setPrefs } from '../src/me/prefs';

const DE = 'Bist du heute Abend noch in Altstetten?';

beforeEach(() => {
  mockMem.clear();
  _reset();
  store.reset();
  mockStatus.mockReset();
  mockTranslate.mockReset();
  mockDetect.mockReset();
  mockDetect.mockResolvedValue({ lang: 'de', p: 0.98 });
  mockTranslate.mockImplementation(async (x) => x.map(() => 'Are you still around Altstetten tonight?'));
});

describe('on-device translation (#106)', () => {
  it('AC-07.11 Automatic + pack installed: translated on the phone, cached, nothing sent to the server', async () => {
    mockStatus.mockResolvedValue('installed');
    const s = await plan('c1', 'm1', DE, 'auto');
    expect(s).toEqual({ kind: 'done', tr: { from: 'de', to: 'en', text: 'Are you still around Altstetten tonight?' } });
    expect(mockTranslate).toHaveBeenCalledWith([DE], 'de', 'en');
    expect(api).not.toHaveBeenCalled();
    _reset();
    mockTranslate.mockClear();
    expect((await plan('c1', 'm1', DE, 'auto')).kind).toBe('done'); // from the encrypted store
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('AC-07.12 pack missing: chip with download, never a silent download', async () => {
    mockStatus.mockResolvedValue('supported');
    expect(await plan('c1', 'm1', DE, 'auto')).toEqual({ kind: 'offer', from: 'de', download: true });
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('AC-07.12 Tap mode: chip only; Off: nothing', async () => {
    mockStatus.mockResolvedValue('installed');
    expect(await plan('c1', 'm1', DE, 'tap')).toEqual({ kind: 'offer', from: 'de', download: false });
    expect(await plan('c1', 'm2', DE, 'off')).toEqual({ kind: 'none' });
    expect(mockTranslate).not.toHaveBeenCalled();
    const tr = await translateMessage('c1', 'm1', DE, 'de');
    expect(tr?.text).toMatch(/Altstetten/);
  });

  it('per-chat switch overrides the global mode', async () => {
    await setPrefs({ translate: 'auto' });
    expect(modeFor({})).toBe('auto');
    expect(modeFor({ translate: 'off' })).toBe('off');
    await setPrefs({ translate: 'tap' });
    expect(modeFor({})).toBe('tap');
  });

  it('R-07.26 skips short, unsure, same-language and unsupported text', async () => {
    mockStatus.mockResolvedValue('installed');
    expect(worthTranslating('ok 👍')).toBe(false);
    expect(worthTranslating('https://example.com/abcdefgh')).toBe(false);
    expect(await plan('c1', 'a', 'ok 👍', 'auto')).toEqual({ kind: 'none' });
    mockDetect.mockResolvedValueOnce({ lang: 'de', p: 0.4 });
    expect(await plan('c1', 'b', DE, 'auto')).toEqual({ kind: 'none' });
    mockDetect.mockResolvedValueOnce({ lang: 'en', p: 0.99 });
    expect(await plan('c1', 'c', 'Are you around tonight?', 'auto')).toEqual({ kind: 'none' });
    mockStatus.mockResolvedValueOnce('unsupported');
    expect(await plan('c1', 'd', DE, 'auto')).toEqual({ kind: 'none' });
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('AC-07.14 deleting a message or the chat deletes its translation', async () => {
    mockStatus.mockResolvedValue('installed');
    await store.put('c1', { id: 'm1', at: 1 });
    await store.put('c1', { id: 'm2', at: 2 });
    await plan('c1', 'm1', DE, 'auto');
    await plan('c1', 'm2', DE, 'auto');
    expect(mockMem.has(store.trKey('c1', 'm1'))).toBe(true);
    await store.remove('c1', ['m1']);
    expect(mockMem.has(store.trKey('c1', 'm1'))).toBe(false);
    expect(mockMem.has(store.trKey('c1', 'm2'))).toBe(true);
    await store.drop('c1');
    expect([...mockMem.keys()].some((k) => k.startsWith('tr:'))).toBe(false);
  });

  it('strings exist in en, fr and de', () => {
    expect(Object.keys(trFr).sort()).toEqual(Object.keys(trEn).sort());
    expect(Object.keys(trDe).sort()).toEqual(Object.keys(trEn).sort());
  });
});

describe('AC-07.13 built-in quick replies are keyed', () => {
  it('every language has the same 6 quick replies in the same order', () => {
    expect(txEn.chat.quick).toHaveLength(6);
    expect(de.chat?.quick).toHaveLength(6);
    expect(fr.chat?.quick).toHaveLength(6);
    expect(de.chat?.quick?.[0]).toBe('Ja 🔥');
  });
});

describe('language is not an Explore filter (#106)', () => {
  it('drops a saved languages filter and does not count it', () => {
    const f = restoreFilters(JSON.stringify({ languages: ['de'], tribes: ['bear'] }));
    expect(f.languages).toBeUndefined();
    expect(f.tribes).toEqual(['bear']);
    expect(restoreFilters(null).verified_only).toBe(true);
  });
});

// #135 chat media tray + Sent recently (F-08 R-08.12–R-08.14).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockDisk = new Map<string, Uint8Array>();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return [...mockDisk.keys()].some((k) => k.startsWith(this.uri + '/'));
    }
    create() {}
    delete() {
      for (const k of [...mockDisk.keys()]) if (k.startsWith(this.uri + '/')) mockDisk.delete(k);
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    create() {
      mockDisk.set(this.uri, new Uint8Array());
    }
    write(b: Uint8Array) {
      mockDisk.set(this.uri, b);
    }
    async bytes() {
      return mockDisk.get(this.uri)!;
    }
    delete() {
      mockDisk.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { document: { uri: 'doc' } } };
});

jest.mock('../src/chat/kv', () => {
  const st = new Map<string, unknown>();
  const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return {
    kv: {
      get: async (k: string) => (st.has(k) ? clone(st.get(k)) : null),
      set: async (k: string, v: unknown) => void st.set(k, clone(v)),
      del: async (k: string) => void st.delete(k),
      wipe: async () => st.clear(),
    },
  };
});

// eslint-disable-next-line import/first
import * as Recent from '../src/chat/recent';
// eslint-disable-next-line import/first
import { kv } from '../src/chat/kv';
// eslint-disable-next-line import/first
import { mxDe, mxEn, mxFr, timeLeft } from '../src/i18n/media';
// eslint-disable-next-line import/first
import { holdTray, keyboardClosesTray, toggle } from '../src/chat/pick';

const pic = (n: number) => new Uint8Array([0xff, 0xd8, n, n + 1, n + 2]);

beforeEach(async () => {
  mockDisk.clear();
  await (kv as unknown as { wipe: () => Promise<void> }).wipe();
});

describe('R-08.14 Sent recently', () => {
  it('stores ciphertext only and decrypts back on this phone', async () => {
    const id = (await Recent.keep(pic(1), { mime: 'image/jpeg', w: 10, h: 20 }, 'c1'))!;
    const file = [...mockDisk.entries()].find(([k]) => k.endsWith(`${id}.bin`))![1];
    expect(Array.from(file)).not.toEqual(Array.from(pic(1)));
    const [r] = await Recent.list();
    expect(r.to).toEqual(['c1']);
    expect(Array.from((await Recent.bytes(r))!)).toEqual(Array.from(pic(1)));
  });

  it('keeps the last 30, deleting the oldest files', async () => {
    for (let i = 0; i < Recent.MAX + 3; i++) await Recent.keep(pic(i), { mime: 'image/jpeg' }, 'c1');
    expect((await Recent.list()).length).toBe(Recent.MAX);
    expect(mockDisk.size).toBe(Recent.MAX);
  });

  it('re-send moves to front and remembers the chat', async () => {
    const a = (await Recent.keep(pic(1), { mime: 'image/jpeg' }, 'c1'))!;
    await Recent.keep(pic(2), { mime: 'image/jpeg' }, 'c1');
    await Recent.touch(a, 'c2');
    const [first] = await Recent.list();
    expect(first.id).toBe(a);
    expect(first.to).toEqual(['c1', 'c2']);
  });

  it('remove and clear leave no file and no index (AC-08.4)', async () => {
    const a = (await Recent.keep(pic(1), { mime: 'image/jpeg' }, 'c1'))!;
    await Recent.keep(pic(2), { mime: 'image/jpeg' }, 'c1');
    await Recent.remove(a);
    expect((await Recent.list()).map((r) => r.id)).not.toContain(a);
    expect(mockDisk.size).toBe(1);
    await Recent.clear();
    expect(await Recent.list()).toEqual([]);
    expect(mockDisk.size).toBe(0);
  });
});

describe('R-08.12 selection', () => {
  it('keeps tap order, untaps, caps at 10', async () => {
    const p = (k: string) => ({ key: k, src: { kind: 'uri' as const, uri: k } });
    let s = toggle([], p('a'));
    s = toggle(s, p('b'));
    s = toggle(s, p('a'));
    s = toggle(s, p('c'));
    expect(s.map((x) => x.key)).toEqual(['b', 'c']);
    for (let i = 0; i < 20; i++) s = toggle(s, p('x' + i));
    expect(s.length).toBe(10);
  });
});

describe('strings', () => {
  it('en / fr / de have the same keys', () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(mxFr)).toEqual(keys(mxEn));
    expect(keys(mxDe)).toEqual(keys(mxEn));
  });
  it('time left', () => {
    const now = 1_000_000;
    expect(timeLeft(now + 23.5 * 3600e3, now)).toBe('23 h');
    expect(timeLeft(now + 5 * 60e3, now)).toBe('5 min');
    expect(timeLeft(now + 3 * 86400e3, now)).toBe('3 d');
  });
});

describe('#222 tray sheets keep the keyboard', () => {
  it('keyboard closes the tray only when no tray sheet is typing', () => {
    expect(keyboardClosesTray()).toBe(true);
    holdTray(true);
    expect(keyboardClosesTray()).toBe(false);
    holdTray(false);
    expect(keyboardClosesTray()).toBe(true);
    holdTray(false); // extra release never goes negative
    holdTray(true);
    expect(keyboardClosesTray()).toBe(false);
    holdTray(false);
  });
});

describe('#138 video labels', () => {
  it('counts photos and videos, formats length', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mxEn, mmss } = require('../src/i18n/media') as typeof import('../src/i18n/media');
    expect(mxEn.countsPV(3, 1)).toBe('3 photos · 1 video');
    expect(mxEn.countsPV(0, 2)).toBe('2 videos');
    expect(mxEn.countsPV(1, 0)).toBe('1 photo');
    expect(mmss(75)).toBe('1:15');
    expect(mmss(9)).toBe('0:09');
  });
});

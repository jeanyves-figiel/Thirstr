// #159 video check (F-18 R-18.7–R-18.18): device-only state machine + strings.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { kv } from '../src/chat/kv';
import * as V from '../src/chat/vcheck';
import { moveText, vcDe, vcEn, vcFr } from '../src/i18n/vcheck';

jest.mock('../src/chat/kv', () => {
  const st = new Map<string, unknown>();
  const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  return {
    kv: {
      get: async (k: string) => (st.has(k) ? clone(st.get(k)) : null),
      set: async (k: string, v: unknown) => void st.set(k, clone(v)),
      del: async (k: string) => void st.delete(k),
      keys: async (p: string) => [...st.keys()].filter((k) => k.startsWith(p)),
      wipe: async () => st.clear(),
    },
  };
});
jest.mock('../src/api/client', () => ({ api: jest.fn(async () => ({})) }));

const clip = { blob: 'b1', key: 'k', iv: 'i', dur: 4000 };
const req = (rid: string, move = 7, mutual = false) => ({ t: 'vcheck' as const, op: 'request' as const, rid, move, mutual, exp: Date.now() + V.TTL_MS });

beforeEach(async () => {
  await kv.wipe();
  V.resetVc();
  await V.loadVc();
});

describe('R-18.8 moves', () => {
  it('draws one of 48 two-step moves, never the same twice in a row', () => {
    expect(V.MOVES).toBe(48);
    for (let i = 0; i < 200; i++) {
      const a = V.drawMove();
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(V.MOVES);
      expect(V.drawMove(a)).not.toBe(a);
    }
  });
  it('has the same move list in en / fr / de', () => {
    for (const t of [vcEn, vcFr, vcDe]) {
      expect(t.hands).toHaveLength(V.HANDS.length);
      expect(t.faces).toHaveLength(V.FACES.length);
    }
    expect(moveText(vcEn, 0)).toBe('Peace sign, then touch your ear');
    expect(moveText(vcFr, 0)).toBe('Signe de paix, puis touche ton oreille');
    expect(V.moveEmoji(0)).toBe('✌️👂');
  });
});

describe('R-18.9–R-18.16 flow', () => {
  it('asker: request → clip → watched → confirm gives the badge; recorder gets the line, no badge', async () => {
    // Asker's phone.
    expect(await V.apply('marco', req('r1'), true)).toBe(true);
    expect(V.get('r1')?.dir).toBe('out');
    expect(V.canAsk('marco')).toBe(false);
    expect(await V.apply('marco', { t: 'vcheck', op: 'clip', rid: 'r1', clip }, false)).toBe(true);
    expect(V.effective(V.get('r1'))).toBe('recorded');
    expect(V.get('r1')?.clip?.blob).toBe('b1');
    await V.mark('r1', 'watched');
    expect(V.get('r1')?.clip).toBeUndefined();
    expect(await V.apply('marco', { t: 'vcheck', op: 'confirm', rid: 'r1' }, true)).toBe(true);
    expect(V.badgeOf('marco')?.fresh).toBe(true);

    // Recorder's phone.
    V.resetVc();
    await kv.wipe();
    expect(await V.apply('jean', req('r1'), false)).toBe(true);
    expect(V.get('r1')?.dir).toBe('in');
    expect(await V.apply('jean', { t: 'vcheck', op: 'clip', rid: 'r1', clip }, true)).toBe(true);
    expect(V.get('r1')?.clip).toBeUndefined(); // the recorder never keeps the key
    expect(await V.apply('jean', { t: 'vcheck', op: 'done', rid: 'r1' }, false)).toBe(false);
    expect(V.get('r1')?.state).toBe('watched');
    expect(await V.apply('jean', { t: 'vcheck', op: 'confirm', rid: 'r1' }, false)).toBe(true);
    expect(V.badgeOf('jean')).toBeNull();
  });

  it('decline is quiet, shows declined, ask again only after 1 h', async () => {
    await V.apply('marco', req('r1'), true);
    expect(await V.apply('marco', { t: 'vcheck', op: 'decline', rid: 'r1' }, false)).toBe(false);
    expect(V.effective(V.get('r1'))).toBe('declined');
    expect(V.canAsk('marco')).toBe(false);
    expect(V.canAsk('marco', Date.now() + V.ASK_AGAIN_MS + 1000)).toBe(true);
  });

  it('requests and clips expire after 24 h', async () => {
    await V.apply('marco', req('r1'), true);
    expect(V.effective(V.get('r1'), Date.now() + V.TTL_MS + 1000)).toBe('expired');
    expect(V.canAsk('marco', Date.now() + V.TTL_MS + V.ASK_AGAIN_MS)).toBe(true);
  });

  it('a clip for a request that is not open is ignored', async () => {
    await V.apply('marco', req('r1'), true);
    await V.apply('marco', { t: 'vcheck', op: 'cancel', rid: 'r1' }, true);
    expect(await V.apply('marco', { t: 'vcheck', op: 'clip', rid: 'r1', clip }, false)).toBe(false);
    expect(await V.apply('marco', { t: 'vcheck', op: 'clip', rid: 'zz', clip }, false)).toBe(false);
  });

  it('mutual: the asker’s own clip arrives as an offer the other side can watch', async () => {
    expect(await V.apply('jean', req('r1', 3, true), false)).toBe(true);
    expect(await V.apply('jean', { t: 'vcheck', op: 'clip', rid: 'r1m', move: 3, offer: true, clip }, false)).toBe(true);
    expect(V.get('r1m')?.dir).toBe('out');
    expect(V.get('r1m')?.clip?.blob).toBe('b1');
  });
});

describe('R-18.7 limits', () => {
  it('recorder ignores a 4th request in 24 h and any request while one is open', async () => {
    expect(await V.apply('spam', req('a'), false)).toBe(true);
    expect(await V.apply('spam', req('b'), false)).toBe(false); // one open at a time
    await V.apply('spam', { t: 'vcheck', op: 'cancel', rid: 'a' }, false);
    expect(await V.apply('spam', req('c'), false)).toBe(true);
    await V.apply('spam', { t: 'vcheck', op: 'cancel', rid: 'c' }, false);
    expect(await V.apply('spam', req('d'), false)).toBe(true);
    await V.apply('spam', { t: 'vcheck', op: 'cancel', rid: 'd' }, false);
    expect(await V.apply('spam', req('e'), false)).toBe(false);
  });

  it('asker can send at most 3 requests per chat per day', async () => {
    for (const r of ['a', 'b', 'c']) {
      expect(V.canAsk('marco')).toBe(true);
      await V.apply('marco', req(r), true);
      await V.apply('marco', { t: 'vcheck', op: 'cancel', rid: r }, true);
    }
    expect(V.canAsk('marco')).toBe(false);
  });
});

describe('R-18.17 badge', () => {
  it('fades after 90 days, goes on block, survives a relaunch', async () => {
    await V.apply('marco', req('r1'), true);
    await V.apply('marco', { t: 'vcheck', op: 'clip', rid: 'r1', clip }, false);
    await V.apply('marco', { t: 'vcheck', op: 'confirm', rid: 'r1' }, true);
    expect(V.badgeOf('marco', Date.now() + V.BADGE_MS + 1)?.fresh).toBe(false);
    V.resetVc();
    await V.loadVc();
    expect(V.badgeOf('marco')).not.toBeNull();
    await V.forgetVc('marco');
    expect(V.badgeOf('marco')).toBeNull();
    expect(V.get('r1')).toBeUndefined();
  });
});

describe('#159 regression: chat ⋯ entry never silently disappears', () => {
  it('stays listed in 1:1 chats while a check is open, after a decline and at the daily limit', async () => {
    const shown = { available: true, on: true, group: false };
    expect(V.menuShown(shown)).toBe(true);
    await V.apply('marco', req('r1'), true);
    expect(V.askBlock('marco')).toBe('open');
    expect(V.menuShown(shown)).toBe(true);
    await V.apply('marco', { t: 'vcheck', op: 'decline', rid: 'r1' }, false);
    expect(V.askBlock('marco')).toBe('declined');
    expect(V.askBlock('marco', Date.now() + V.ASK_AGAIN_MS + 1000)).toBeNull();
    for (const r of ['r2', 'r3']) {
      await V.apply('marco', req(r), true);
      await V.apply('marco', { t: 'vcheck', op: 'cancel', rid: r }, true);
    }
    expect(V.askBlock('marco', Date.now() + V.ASK_AGAIN_MS + 1000)).toBe('limit');
  });
  it('is hidden only by the server kill switch, in groups, or where the phone can’t play it safely', () => {
    expect(V.menuShown({ available: true, on: false, group: false })).toBe(false);
    expect(V.menuShown({ available: true, on: true, group: true })).toBe(false);
    expect(V.menuShown({ available: false, on: true, group: false })).toBe(false);
  });
  it('ChatScreen gates the row with menuShown + the video_check flag, not canAsk', () => {
    const src = require('fs').readFileSync('src/chat/ChatScreen.tsx', 'utf8') as string;
    expect(src).toMatch(/V\.menuShown\(\{ available: vcAvailable, on: flag\('video_check'\)/);
    expect(src).not.toMatch(/V\.canAsk\(conv\.peer\) \? \(\s*<SheetRow\s+testID="menu-vcheck"/);
  });
});

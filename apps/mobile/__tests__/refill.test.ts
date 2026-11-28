// F-25 Refill (#339, D-26): device-only rules, triggers, pacing and the sealed yes.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { kv } from '../src/chat/kv';
import * as R from '../src/refill/refill';
import { rfxDe, rfxEn, rfxFr } from '../src/i18n/refill';

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

const now = 1_800_000_000_000;
const D = R.DAY;
const chat = (peer: string, o: Partial<R.ChatFacts> = {}): R.ChatFacts => ({ peer, iWrote: true, theyWrote: true, lastAt: now - 30 * D, name: 'Marco, 31', photo: null, ...o });
const on: R.Prefs = { show: true, triggers: { ...R.DEFAULT_TRIGGERS } };
const viewer = (o: Partial<R.Viewer> = {}): R.Viewer => ({ plus: true, safeMode: false, createdAt: now - 100 * D, prefs: on, ...o });

beforeEach(async () => {
  await (kv as unknown as { wipe: () => Promise<void> }).wipe();
  R.resetRefill();
  await R.loadRefill();
  await R.setPrefs({ show: true });
});

describe('who can come back (R-25.3, R-25.4)', () => {
  it('needs a two-way chat or a meetup', () => {
    expect(R.pastContact(chat('a'), null)).toBe(true);
    expect(R.pastContact(chat('a', { theyWrote: false }), null)).toBe(false);
    expect(R.pastContact(null, { met: now })).toBe(true);
  });

  it('respects his switch, mute, "No", 21 days quiet, Not now and 60 days per person', () => {
    expect(R.eligible(chat('a'), null, true, now)).toBe(true);
    expect(R.eligible(chat('a'), null, false, now)).toBe(false);
    expect(R.eligible(chat('a'), { muted: true }, true, now)).toBe(false);
    expect(R.eligible(chat('a'), { rating: 'no' }, true, now)).toBe(false);
    expect(R.eligible(chat('a', { lastAt: now - 20 * D }), null, true, now)).toBe(false);
    expect(R.eligible(chat('a'), { later: now + D }, true, now)).toBe(false);
    expect(R.eligible(chat('a'), { carded: now - 59 * D }, true, now)).toBe(false);
    expect(R.eligible(chat('a'), { carded: now - 61 * D }, true, now)).toBe(true);
  });

  it('viewer side: Plus, not Safe Mode, switched on, 7 days on Thirstr, not snoozed', () => {
    expect(R.viewerReady(viewer(), now)).toBe(true);
    expect(R.viewerReady(viewer({ plus: false }), now)).toBe(false);
    expect(R.viewerReady(viewer({ safeMode: true }), now)).toBe(false);
    expect(R.viewerReady(viewer({ prefs: { ...on, show: null } }), now)).toBe(false);
    expect(R.viewerReady(viewer({ createdAt: now - 6 * D }), now)).toBe(false);
    expect(R.viewerReady(viewer({ prefs: { ...on, snoozeUntil: now + D } }), now)).toBe(false);
  });
});

describe('triggers (R-25.6)', () => {
  it('back nearby only after 14 days away; anniversary and gone quiet when switched on', () => {
    const t = R.DEFAULT_TRIGGERS;
    expect(R.triggerFor('nearby', chat('a'), null, false, now, t)).toBe('nearby');
    expect(R.triggerFor('nearby', chat('a'), { seen: now - 3 * D }, false, now, t)).toBeNull();
    expect(R.triggerFor('nearby', chat('a'), { seen: now - 15 * D }, false, now, t)).toBe('nearby');
    const all = { ...t, anniversary: true, quiet: true };
    expect(R.triggerFor('nearby', chat('a'), { met: now - 365 * D, seen: now }, false, now, all)).toBe('anniversary');
    expect(R.triggerFor('nearby', chat('a', { fav: true, lastAt: now - 61 * D }), { seen: now }, true, now, all)).toBe('quiet');
    expect(R.triggerFor('trip', chat('a'), null, false, now, { ...t, trip: false })).toBeNull();
  });

  it('anniversary is 6 or 12 months ± 3 days', () => {
    expect(R.anniversary(now - 182 * D, now)).toBe(true);
    expect(R.anniversary(now - 365 * D, now)).toBe(true);
    expect(R.anniversary(now - 730 * D - 2 * D, now)).toBe(true);
    expect(R.anniversary(now - 100 * D, now)).toBe(false);
    expect(R.anniversary(now - 250 * D, now)).toBe(false);
  });
});

describe('observe → one card a day (R-25.5)', () => {
  it('picks the most "now" reason, then waits a day', async () => {
    const chats = new Map([
      ['a', chat('a')],
      ['b', chat('b', { name: 'Leo' })],
    ]);
    await R.observe('nearby', [{ id: 'a', resurface: true }], chats, viewer(), now);
    expect(R.currentCard()).toMatchObject({ kind: 'person', peer: 'a', trigger: 'nearby' });
    await R.observe('place', [{ id: 'b', resurface: true, where: 'Heaven' }], chats, viewer(), now + 3600_000);
    expect(R.currentCard()).toMatchObject({ peer: 'a' });
    await R.dismissCard(true, now + 2 * 3600_000);
    await R.observe('place', [{ id: 'b', resurface: true, where: 'Heaven' }], chats, viewer(), now + 3 * 3600_000);
    expect(R.currentCard()).toBeNull();
    await R.observe('place', [{ id: 'b', resurface: true, where: 'Heaven' }], chats, viewer(), now + D + 1);
    expect(R.currentCard()).toMatchObject({ peer: 'b', trigger: 'place', where: 'Heaven' });
    // Not now on "a": not for 60 days.
    expect(R.rec('a')?.later).toBe(now + 2 * 3600_000 + R.PER_PERSON);
  });

  it('never shows someone who switched it off, nor without Plus', async () => {
    const chats = new Map([['a', chat('a')]]);
    await R.observe('nearby', [{ id: 'a', resurface: false }], chats, viewer(), now);
    expect(R.currentCard()).toBeNull();
    await R.observe('nearby', [{ id: 'a', resurface: true }], chats, viewer({ plus: false }), now + 15 * D);
    expect(R.currentCard()).toBeNull();
  });

  it('asks once (intro) when never asked and a past contact exists', async () => {
    await R.setPrefs({ show: null });
    await R.observe('nearby', [], new Map([['a', chat('a')]]), viewer({ prefs: { ...on, show: null } }), now);
    expect(R.currentCard()).toMatchObject({ kind: 'intro' });
    await R.setPrefs({ show: false });
    expect(R.currentCard()).toBeNull();
  });
});

describe('sealed yes (concept A)', () => {
  it('one side alone shows nothing; both yes = one match', async () => {
    const seen: string[] = [];
    const off = R.onMatch((e) => seen.push(e.peer));
    const his = await R.receiveSeal('a', { t: 'refill', op: 'yes', until: now + 99 * D }, { name: 'Marco', photo: null }, now);
    expect(his).toBe(false);
    expect(R.rec('a')?.in).toBe(now + R.SEAL_TTL);
    const mine = await R.sealMine('a', true, { name: 'Marco', photo: null }, now + 1);
    expect(mine.match).toBe(true);
    expect(mine.p).toEqual({ t: 'refill', op: 'yes', until: now + 1 + R.SEAL_TTL });
    expect(seen).toEqual(['a']);
    // Re-sending does not match twice.
    await R.receiveSeal('a', { t: 'refill', op: 'yes', until: now + D }, { name: 'Marco', photo: null }, now + 2);
    expect(seen).toEqual(['a']);
    off();
  });

  it('expired or withdrawn yes never matches; muted people are ignored', async () => {
    await R.receiveSeal('a', { t: 'refill', op: 'yes', until: now + D }, { name: 'M', photo: null }, now);
    await R.receiveSeal('a', { t: 'refill', op: 'withdraw' }, { name: 'M', photo: null }, now);
    expect((await R.sealMine('a', true, { name: 'M', photo: null }, now)).match).toBe(false);
    await R.receiveSeal('b', { t: 'refill', op: 'yes', until: now + D }, { name: 'B', photo: null }, now);
    expect((await R.sealMine('b', true, { name: 'B', photo: null }, now + 2 * D)).match).toBe(false);
    await R.mute('c');
    await R.sealMine('c', true, { name: 'C', photo: null }, now);
    expect(await R.receiveSeal('c', { t: 'refill', op: 'yes', until: now + D }, { name: 'C', photo: null }, now)).toBe(false);
  });

  it('his yes is never in my data export', async () => {
    await R.receiveSeal('a', { t: 'refill', op: 'yes', until: now + D }, { name: 'M', photo: null }, now);
    await R.rate('a', 'yes', now);
    const x = R.exportRefill();
    expect(x.people.a).toMatchObject({ rating: 'yes' });
    expect(JSON.stringify(x)).not.toContain('"in"');
  });
});

describe('after the date (concept C)', () => {
  it('"We met" asks once; "No" removes the card and he never comes back', async () => {
    const asked: string[] = [];
    const off = R.onAsk((p) => asked.push(p));
    await R.markMet('a', { name: 'Leo' }, true, now);
    expect(asked).toEqual(['a']);
    await R.rate('a', 'no', now);
    expect(R.eligible(null, R.rec('a'), true, now + 100 * D)).toBe(false);
    expect(R.book('no').map((x) => x.peer)).toEqual(['a']);
    off();
  });
});

describe('copy', () => {
  it('fr and de have every key', () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v).map((x) => `${k}.${x}`) : [k]));
    expect(keys(rfxFr).sort()).toEqual(keys(rfxEn).sort());
    expect(keys(rfxDe).sort()).toEqual(keys(rfxEn).sort());
  });
});

// F-21 Moments (#212): viewer flow (S-77), Moments row order (R-21.10), expiry on the phone (R-21.22).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('../src/api/client', () => ({ api: jest.fn(() => Promise.resolve({})), putBlob: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

import { step, type St } from '../src/moments/flow';
import { alive, isSeen, markSeen, minutesLeft } from '../src/moments/api';
import { rowPeople } from '../src/moments/MomentsRow';
import type { Card } from '../src/api/types';

const m = (id: string, at = '2026-11-21T10:00:00Z', seen = false) => ({ id, url: 'u', thumb_url: null, caption: null, caption_style: 'clean' as const, created_at: at, expires_at: '2099-01-01T00:00:00Z', seen });
const base: St = { pi: 0, mi: 0, list: null, done: false, n: 3, self: false, restart: 0 };

describe('viewer flow', () => {
  test('starts on the first unseen Moment', () => {
    const s = step(base, { t: 'load', pi: 0, list: [m('a', undefined, true), m('b'), m('c')] });
    expect(s.mi).toBe(1);
  });

  test('next walks Moments, then the next person, then closes', () => {
    let s = step(base, { t: 'load', pi: 0, list: [m('a'), m('b')] });
    s = step(s, { t: 'next' });
    expect(s.mi).toBe(1);
    s = step(s, { t: 'next' });
    expect(s).toMatchObject({ pi: 1, mi: 0, list: null, done: false });
    s = step({ ...s, pi: 2 }, { t: 'load', pi: 2, list: [m('z')] });
    s = step(s, { t: 'next' });
    expect(s.done).toBe(true);
  });

  test('a load for another person is ignored; an empty one skips him', () => {
    expect(step(base, { t: 'load', pi: 1, list: [m('a')] })).toBe(base);
    expect(step(base, { t: 'load', pi: 0, list: [] }).pi).toBe(1);
  });

  test('own Moments never move to another person', () => {
    const s = step({ ...base, self: true, n: 1 }, { t: 'load', pi: 0, list: [m('a')] });
    expect(step(s, { t: 'next' }).done).toBe(true);
  });

  test('prev restarts the first Moment of the first person', () => {
    const s = step(base, { t: 'load', pi: 0, list: [m('a')] });
    expect(step(s, { t: 'prev' }).restart).toBe(1);
  });

  test('remove and restore (Undo) keep time order', () => {
    let s = step({ ...base, self: true }, { t: 'load', pi: 0, list: [m('a', '2026-11-21T09:00:00Z'), m('b', '2026-11-21T10:00:00Z')] });
    const a = s.list![0];
    s = step(s, { t: 'remove', id: 'a' });
    expect(s.list!.map((x) => x.id)).toEqual(['b']);
    s = step(s, { t: 'restore', m: a });
    expect(s.list!.map((x) => x.id)).toEqual(['a', 'b']);
    s = step(step(s, { t: 'remove', id: 'a' }), { t: 'remove', id: 'b' });
    expect(s.done).toBe(true);
  });
});

describe('Moments row (D-21a B)', () => {
  const card = (id: string, moments: Card['moments']) => ({ id, display_name: id, age: 30, moments }) as Card;
  test('unseen first, grid order kept, people without Moments left out', () => {
    const items = [card('near-seen', { live: 1, unseen: false }), card('none', null), card('mid-new', { live: 2, unseen: true }), card('far-new', { live: 1, unseen: true })];
    expect(rowPeople(items).map((c) => c.id)).toEqual(['mid-new', 'far-new', 'near-seen']);
  });
  test('max 30', () => {
    const items = Array.from({ length: 40 }, (_, i) => card(`p${i}`, { live: 1, unseen: true }));
    expect(rowPeople(items)).toHaveLength(30);
  });
});

describe('phone-side rules', () => {
  test('expired Moments vanish without the network (R-21.22)', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    expect(alive([{ expires_at: '2026-11-21T11:59:00Z' }, { expires_at: '2026-11-21T13:00:00Z' }], now)).toHaveLength(1);
    expect(minutesLeft('2026-11-21T13:00:00Z', now)).toBe(60);
  });
  test('seen is marked at once on the phone (R-21.28)', () => {
    jest.useFakeTimers();
    markSeen('x1');
    expect(isSeen('x1')).toBe(true);
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});

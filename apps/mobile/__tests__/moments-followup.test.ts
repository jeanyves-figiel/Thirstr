// F-21 follow-ups (#221): Blur tool state (R-21.2, D-21c A), live rings (R-21.9), quoted reply (R-21.11).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('../src/api/client', () => ({ api: jest.fn(() => Promise.resolve({})), putBlob: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: '/cache' } }));

import * as B from '../src/moments/blur';
import { badgeOf, clearBadges, markSeen, quoteImage, setBadge, watchedAll, withRings } from '../src/moments/api';

describe('blur tool', () => {
  test('a stroke fills in dabs between finger moves, undo removes it', () => {
    let s = B.begin(B.empty(), 0.1, 0.1, 'm', 9 / 16);
    s = B.extend(s, 0.5, 0.1, 'm', 9 / 16);
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].length).toBeGreaterThan(5);
    expect(B.count(s)).toBe(1);
    s = B.undo(s);
    expect(B.spots(s)).toEqual([]);
  });

  test('tiny moves add nothing', () => {
    const s = B.begin(B.empty(), 0.5, 0.5, 'l', 1);
    expect(B.extend(s, 0.501, 0.5, 'l', 1)).toBe(s);
  });

  test('Blur faces keeps the largest face sharp while Keep mine is on', () => {
    const faces = B.facesFrom([
      [0.3, 0.2, 0.3, 0.2],
      [0.7, 0.6, 0.1, 0.08],
    ]);
    let s = B.blurFaces({ ...B.empty(), faces }, faces);
    expect(s.faces!.map((f) => f.on)).toEqual([false, true]);
    s = B.setKeepMine(s, false);
    expect(s.faces!.map((f) => f.on)).toEqual([true, true]);
    s = B.setKeepMine(s, true);
    expect(s.faces!.map((f) => f.on)).toEqual([false, true]);
    s = B.undo(s);
    expect(B.count(s)).toBe(0);
  });

  test('a single face is blurred even with Keep mine on (nothing else to protect)', () => {
    const faces = B.facesFrom([[0.4, 0.3, 0.2, 0.15]]);
    expect(B.blurFaces({ ...B.empty(), faces }, faces).faces![0].on).toBe(true);
  });

  test('a tap on a blurred face finds it and makes it sharp again', () => {
    const faces = B.facesFrom([
      [0.1, 0.1, 0.2, 0.2],
      [0.6, 0.6, 0.2, 0.2],
    ]);
    const s = B.blurFaces({ ...B.empty(), keepMine: false, faces }, faces);
    const i = B.faceAt(s, 0.7, 0.7);
    expect(i).toBe(1);
    expect(B.toggleFace(s, i).faces![1].on).toBe(false);
    expect(B.faceAt(s, 0.95, 0.05)).toBe(-1);
  });

  test('blur is strong on full-size photos', () => {
    expect(B.sigmaFor(1440)).toBeGreaterThanOrEqual(40);
  });
});

describe('live rings', () => {
  test('a pushed ring wins until the list reloads; a new Moment makes it colourful again', () => {
    markSeen('m1', 'p1');
    expect(watchedAll('p1')).toBe(true);
    const cards = [{ id: 'p1', moments: null }, { id: 'p2', moments: null }];
    setBadge('p1', { live: 2, unseen: true });
    expect(watchedAll('p1')).toBe(false);
    const out = withRings(cards);
    expect(out[0].moments).toEqual({ live: 2, unseen: true });
    expect(out[1]).toBe(cards[1]);
    clearBadges(['p1']);
    expect(badgeOf('p1', null)).toBeNull();
  });

  test('a removal is pushed as null', () => {
    setBadge('p3', null);
    expect(badgeOf('p3', { live: 1, unseen: false })).toBeNull();
  });
});

describe('quoted reply', () => {
  test('only small, well-formed base64 thumbnails are shown', () => {
    expect(quoteImage('/9j/4AAQSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(quoteImage('javascript:alert(1)')).toBeNull();
    expect(quoteImage('A'.repeat(20_000))).toBeNull();
    expect(quoteImage(undefined)).toBeNull();
  });
});

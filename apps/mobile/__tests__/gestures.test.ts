// F-19 (#187): gesture thresholds and helpers (the worklets share these pure functions).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/client', () => ({ api: jest.fn(), API_BASE: 'http://x' }));

import { clamp, colsAfterPinch, commits, nearIds, nextIndex, photoZone, rubber } from '../src/ui/gestureMath';
import { FULL, swipeEnd } from '../src/ui/SwipeRow';
import { hitSlot } from '../src/chat/MsgGestures';
import { panLimit } from '../src/ui/PhotoViewer';
import { gxDe, gxEn, gxFr } from '../src/i18n/gestures';

describe('commit threshold (R-19.6)', () => {
  test('30 % of the travel commits, less does not', () => {
    expect(commits(30, 0, 100)).toBe(true);
    expect(commits(29, 0, 100)).toBe(false);
    expect(commits(-30, 0, 100)).toBe(true);
  });
  test('a fling commits in its own direction only', () => {
    expect(commits(20, 900, 400)).toBe(true);
    expect(commits(20, -900, 400)).toBe(false);
    expect(commits(5, 2000, 400)).toBe(false);
    expect(commits(0, 2000, 400)).toBe(false);
  });
});

test('rubber band moves less than the finger and keeps its sign', () => {
  expect(rubber(100)).toBeLessThan(100);
  expect(rubber(100)).toBeGreaterThan(0);
  expect(rubber(-100)).toBeCloseTo(-rubber(100));
  expect(clamp(5, 0, 3)).toBe(3);
});

test('G8 pinch changes grid size by one step within 2–4', () => {
  expect(colsAfterPinch(3, 1.5)).toBe(2);
  expect(colsAfterPinch(3, 0.6)).toBe(4);
  expect(colsAfterPinch(2, 1.5)).toBe(2);
  expect(colsAfterPinch(4, 0.5)).toBe(4);
  expect(colsAfterPinch(3, 1.1)).toBe(3);
});

test('G9 left 35 % goes back, the rest goes forward', () => {
  expect(photoZone(10, 400)).toBe(-1);
  expect(photoZone(139, 400)).toBe(-1);
  expect(photoZone(141, 400)).toBe(1);
  expect(photoZone(390, 400)).toBe(1);
});

test('G10 next profile stops at both ends', () => {
  expect(nextIndex(0, 3, -1)).toBe(0);
  expect(nextIndex(0, 3, 1)).toBe(1);
  expect(nextIndex(2, 3, 1)).toBe(2);
  const items = Array.from({ length: 300 }, (_, i) => ({ id: 'p' + i })) as { id: string }[];
  const ids = nearIds(items, 'p150');
  expect(ids[0]).toBe('p50');
  expect(ids).toHaveLength(201);
  expect(nearIds(null, 'x')).toEqual(['x']);
});

test('G5 row: long swipe runs the first action, half the buttons opens', () => {
  expect(swipeEnd(-0.7 * 360, 0, 2, 360)).toBe('full');
  expect(swipeEnd(-(FULL * 360 - 1), 0, 2, 360)).toBe('open');
  expect(swipeEnd(-80, 0, 2, 360)).toBe('open');
  expect(swipeEnd(-30, 0, 2, 360)).toBe('closed');
  expect(swipeEnd(-30, -900, 2, 360)).toBe('open');
  expect(swipeEnd(200, 0, 0, 360)).toBe('closed');
});

test('G3 slide to react: emoji under the finger', () => {
  // Bar at x 16, y 300, 5 slots of 52.
  expect(hitSlot(16 + 10, 320, 16, 300, 52, 5)).toBe(0);
  expect(hitSlot(16 + 52 * 4 + 5, 280, 16, 300, 52, 5)).toBe(4);
  expect(hitSlot(16 + 52 * 5 + 5, 320, 16, 300, 52, 5)).toBe(-1);
  expect(hitSlot(30, 500, 16, 300, 52, 5)).toBe(-1);
  expect(hitSlot(-1, -1, 16, 300, 52, 5)).toBe(-1);
});

test('G13 zoomed photo pans until its edge meets the screen', () => {
  expect(panLimit(400, 1)).toBe(0);
  expect(panLimit(400, 2)).toBe(200);
});

test('gesture strings exist in en, fr, de', () => {
  const keys = Object.keys(gxEn).sort();
  expect(Object.keys(gxFr).sort()).toEqual(keys);
  expect(Object.keys(gxDe).sort()).toEqual(keys);
});

describe('map marker taps (#187 follow-up)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { once } = require('../src/explore/mapShared') as typeof import('../src/explore/mapShared');
  test('runs once when the marker and its Pressable both fire', () => {
    const fn = jest.fn();
    expect(once('a', fn, 1000)).toBe(true);
    expect(once('a', fn, 1100)).toBe(false);
    expect(once('b', fn, 1150)).toBe(true);
    expect(once('b', fn, 2000)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('swipe between profiles (G10)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stepIndex } = require('../src/profile/profileCache') as typeof import('../src/profile/profileCache');
  const ids = ['a', 'b', 'c', 'd'];
  test('next and previous in grid order', () => {
    expect(stepIndex(ids, 1, 1, () => false)).toBe(2);
    expect(stepIndex(ids, 1, -1, () => false)).toBe(0);
  });
  test('skips profiles that are not available', () => {
    expect(stepIndex(ids, 0, 1, (x) => x === 'b' || x === 'c')).toBe(3);
  });
  test('none at the ends', () => {
    expect(stepIndex(ids, 3, 1, () => false)).toBe(-1);
    expect(stepIndex(ids, 0, -1, () => false)).toBe(-1);
    expect(stepIndex(ids, 2, 1, (x) => x === 'd')).toBe(-1);
  });
});

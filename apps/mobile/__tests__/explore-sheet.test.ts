// F-04 #100: grid sheet snaps (R-04.14), auto-fit zoom (R-04.15), quiet detection (R-04.16).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/client', () => ({ api: jest.fn(), API_BASE: 'http://x' }));

import { restoreSnap, snapAfterDrag, snapHeight, STRIP } from '../src/explore/GridSheet';
import { fitCamera, isNear, START_ZOOM } from '../src/explore/mapShared';

const H = 680;
const TAB = 96;

describe('grid sheet', () => {
  test('two stops (#250): strip above the tab bar, then full', () => {
    expect(snapHeight('peek', H, TAB)).toBe(TAB + STRIP);
    expect(snapHeight('full', H, TAB)).toBe(H);
  });

  test('release snaps to nearest, a fling moves one step', () => {
    expect(snapAfterDrag(snapHeight('full', H, TAB) - 30, 0, H, TAB, 'peek')).toBe('full');
    expect(snapAfterDrag(snapHeight('peek', H, TAB) + 40, 0, H, TAB, 'full')).toBe('peek');
    expect(snapAfterDrag(snapHeight('peek', H, TAB), -1.2, H, TAB, 'peek')).toBe('full');
    expect(snapAfterDrag(snapHeight('full', H, TAB), 1.2, H, TAB, 'full')).toBe('peek');
    expect(snapAfterDrag(0, 1.2, H, TAB, 'peek')).toBe('peek');
  });

  test('saved half from before #250 opens as the strip', () => {
    expect(restoreSnap('half')).toBe('peek');
    expect(restoreSnap('full')).toBe('full');
    expect(restoreSnap(null)).toBe('peek');
  });
});

describe('auto-fit zoom (AC-04.7)', () => {
  const p = { lat: 47.37, lng: 8.54 };

  test('1 km fits closer than 25 km and stays within 9–15', () => {
    const near = fitCamera(p, 1000, 390, 680, 380);
    const far = fitCamera(p, 25_000, 390, 680, 380);
    expect(near.zoom).toBeGreaterThan(far.zoom);
    expect(near.zoom).toBeLessThanOrEqual(15);
    expect(far.zoom).toBeGreaterThanOrEqual(9);
    expect(fitCamera(p, 100, 390, 680, 380).zoom).toBe(15);
  });

  test('no fit radius keeps the start zoom', () => {
    expect(fitCamera(p, null, 390, 680, 380).zoom).toBe(START_ZOOM);
  });

  test('centre moves south so the viewer sits above the sheet', () => {
    const c = fitCamera(p, 1000, 390, 680, 380);
    expect(c.lat).toBeLessThan(p.lat);
    expect(c.lng).toBe(p.lng);
    expect(fitCamera(p, 1000, 390, 680, 0).lat).toBeCloseTo(p.lat, 6);
  });
});

test('within 2 km = exact < 2 km or an area bucket up to 1–2 km (R-04.16)', () => {
  expect(isNear({ kind: 'exact', m: 1500 })).toBe(true);
  expect(isNear({ kind: 'exact', m: 2500 })).toBe(false);
  expect(isNear({ kind: 'area', bucket: '1_2k' })).toBe(true);
  expect(isNear({ kind: 'area', bucket: '2_5k' })).toBe(false);
  expect(isNear({ kind: 'city', city: 'Basel' })).toBe(false);
  expect(isNear(null)).toBe(false);
});

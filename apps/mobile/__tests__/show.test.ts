// #247 R-04.22: favorites / friends only on Explore, filtered on the phone.
import { expect, test } from '@jest/globals';
import { away, filterMap, keep, MIN_SHOWN, restoreShow, showIds, wantMore } from '../src/explore/show';

const c = (id: string) => ({ id }) as never as { id: string };

test('everyone keeps the list as is', () => {
  const list = [c('a'), c('b')];
  expect(showIds('all', ['a'], ['b'])).toBeNull();
  expect(keep(list, null)).toBe(list);
});

test('favorites and friends keep only their ids', () => {
  const list = [c('a'), c('b'), c('x')];
  expect(keep(list, showIds('fav', ['a'], ['b'])).map((x) => x.id)).toEqual(['a']);
  expect(keep(list, showIds('friends', ['a'], ['b', 'x'])).map((x) => x.id)).toEqual(['b', 'x']);
});

test('map drops anonymous count cells while filtered', () => {
  const m = { cells: [{ cell: 'h', res: 8, count: 4 }], pins: [c('a'), c('z')], avatars: [c('b')] } as never;
  const out = filterMap(m, new Set(['a', 'b']))!;
  expect(out.cells).toEqual([]);
  expect(out.pins.map((x) => x.id)).toEqual(['a']);
  expect(out.avatars.map((x) => x.id)).toEqual(['b']);
  expect(filterMap(m, null)).toBe(m);
});

test('away lists the ones not returned, in list order', () => {
  expect(away(new Set(['a', 'b', 'c']), ['c', 'b', 'a'], ['b'])).toEqual(['c', 'a']);
  expect(away(null, ['a'], [])).toEqual([]);
});

test('grid keeps paging only while filtered and short', () => {
  expect(wantMore('fav', 2, 'cur')).toBe(true);
  expect(wantMore('fav', MIN_SHOWN, 'cur')).toBe(false);
  expect(wantMore('fav', 2, null)).toBe(false);
  expect(wantMore('all', 0, 'cur')).toBe(false);
});

test('restore falls back to everyone', () => {
  expect(restoreShow('friends')).toBe('friends');
  expect(restoreShow('nope')).toBe('all');
  expect(restoreShow(null)).toBe('all');
});

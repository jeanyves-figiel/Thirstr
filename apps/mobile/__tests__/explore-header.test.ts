// F-04 R-04.17 live header (#104): filter badge count and count labels.
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('../src/api/client', () => ({ api: jest.fn() }));
import { activeFilterCount, countLabel, defaultFilters } from '../src/explore/explore';

describe('live header (R-04.17)', () => {
  test('filter badge counts only changes from the defaults', () => {
    expect(activeFilterCount(defaultFilters)).toBe(0);
    expect(activeFilterCount({ ...defaultFilters, online_now: true })).toBe(1);
    expect(activeFilterCount({ ...defaultFilters, verified_only: false, age_min: 25, position: [] })).toBe(2);
    expect(activeFilterCount({ ...defaultFilters, position: ['top'] })).toBe(1);
  });

  test('counts are exact up to 99, then 99+, unknown is a dot (never a made-up number)', () => {
    expect(countLabel(0)).toBe('0');
    expect(countLabel(99)).toBe('99');
    expect(countLabel(100)).toBe('99+');
    expect(countLabel(null)).toBe('·');
    expect(countLabel(undefined)).toBe('·');
  });
});

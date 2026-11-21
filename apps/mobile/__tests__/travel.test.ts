// F-20 travel plans (#188): date maths and Visiting labels (R-20.6).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('../src/api/client', () => ({ api: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', languageTag: 'en-GB' }] }));
import type { VisitorTrip } from '../src/api/types';
import { addDays, daysBetween, daysUntil, isoDay, parseDay, rangeLabel, shortLabel, tileTag, today } from '../src/travel/travel';

const day = (n: number) => isoDay(addDays(today(), n));
const vt = (first: number, last: number, here = false): VisitorTrip => ({ city: 'Berlin', country: 'DE', first_day: day(first), last_day: day(last), here, from: null });

describe('travel dates', () => {
  test('calendar days survive DST and month ends', () => {
    expect(daysBetween(parseDay('2026-03-28'), parseDay('2026-03-30'))).toBe(2);
    expect(isoDay(addDays(parseDay('2026-01-31'), 1))).toBe('2026-02-01');
    expect(daysUntil(day(12))).toBe(12);
  });

  test('range label folds the month when shared', () => {
    expect(rangeLabel('2026-12-03', '2026-12-07')).toMatch(/^3–7 Dec/);
    expect(rangeLabel('2026-11-30', '2026-12-02')).toMatch(/30 Nov – 2 Dec/);
  });
});

describe('Visiting labels (R-20.6)', () => {
  test('before arrival counts down, during says Visiting, in town says Here now', () => {
    expect(shortLabel(vt(12, 14))).toBe('Arriving in 12 days');
    expect(shortLabel(vt(1, 3))).toBe('Arriving tomorrow');
    expect(shortLabel(vt(0, 3))).toBe('Visiting');
    expect(shortLabel(vt(-1, 3, true))).toBe('Here now');
    expect(tileTag(vt(12, 14))).toBe('In 12 d');
    expect(tileTag(vt(1, 3))).toBe('Tomorrow');
  });
});

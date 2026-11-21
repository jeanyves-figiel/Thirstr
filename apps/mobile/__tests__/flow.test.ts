import { describe, expect, test } from '@jest/globals';
import { ageOn, basicsValid, daysIn, displayCount, isoBirthday, maskBirthday, nameValid, parseBirthday, screenFor } from '../src/onboarding/flow';
import { areaCell } from '../src/geo/cells';

const me = (step: any) => ({ status: 'active', verified: false, onboarding_step: step, safe_mode: 'auto', profile: null, location: null }) as any;

describe('F-02 flow', () => {
  test('resumes at the last incomplete step', () => {
    expect(screenFor(null)).toBe('welcome');
    expect(screenFor(me('basics'))).toBe('basics');
    expect(screenFor(me('location'))).toBe('location');
    expect(screenFor(me('photo'))).toBe('photo');
    expect(screenFor(me('verify'))).toBe('verify');
    expect(screenFor(me('done'))).toBe('explore');
  });

  test('age on birthday boundary (AC-02.3 mirror)', () => {
    const today = new Date(2026, 10, 17);
    expect(ageOn(new Date(2008, 10, 17), today)).toBe(18);
    expect(ageOn(new Date(2008, 10, 18), today)).toBe(17);
  });

  test('birthday parsing rejects impossible dates', () => {
    expect(parseBirthday('2000-02-30')).toBeNull();
    expect(parseBirthday('2000-02-29')).not.toBeNull();
    expect(parseBirthday('29.02.2000')).toBeNull();
  });

  test('birthday mask inserts dashes for the number pad', () => {
    expect(maskBirthday('1997')).toBe('1997');
    expect(maskBirthday('19970')).toBe('1997-0');
    expect(maskBirthday('19970614')).toBe('1997-06-14');
    expect(maskBirthday('1997-06-14')).toBe('1997-06-14');
    expect(maskBirthday('1997-06-1')).toBe('1997-06-1');
    expect(maskBirthday('199706145')).toBe('1997-06-14');
    expect(parseBirthday(maskBirthday('19970614'))).not.toBeNull();
  });

  test('birthday wheel parts → ISO, day clamped to month length (S-03b)', () => {
    expect(isoBirthday(1997, 5, 14)).toBe('1997-06-14');
    expect(isoBirthday(2001, 1, 31)).toBe('2001-02-28');
    expect(isoBirthday(2000, 1, 31)).toBe('2000-02-29');
    expect(daysIn(2024, 1)).toBe(29);
    expect(parseBirthday(isoBirthday(1990, 11, 31))).not.toBeNull();
  });

  test('name 1–20 chars after trim (S-03a, RF-1)', () => {
    expect(nameValid('Max')).toBe(true);
    expect(nameValid('  ')).toBe(false);
    expect(nameValid('x'.repeat(20))).toBe(true);
    expect(nameValid('x'.repeat(21))).toBe(false);
  });

  test('basics validation mirrors server (R-02.4, R-02.5)', () => {
    const ok = { display_name: 'Max', birthdate: '1999-01-01', gender: 'man', gender_other: '', here_for: ['hookup'] };
    expect(basicsValid(ok)).toBe(true);
    expect(basicsValid({ ...ok, display_name: ' ' })).toBe(false);
    expect(basicsValid({ ...ok, gender: 'other' })).toBe(false);
    expect(basicsValid({ ...ok, gender: 'other', gender_other: 'Genderfluid' })).toBe(true);
    expect(basicsValid({ ...ok, here_for: [] })).toBe(false);
    expect(basicsValid({ ...ok, gender: 'unspecified' })).toBe(true); // RF-3 prefer not to say
  });

  test('welcome count rounding (R-02.2)', () => {
    expect(displayCount(9)).toBeNull();
    expect(displayCount(57)).toBe(50);
    expect(displayCount(123)).toBe(123);
  });

  test('client sends only an r9 cell, never coordinates (F-05)', () => {
    const cell = areaCell(47.3769, 8.5417);
    expect(cell).toMatch(/^89[0-9a-f]{13}$/);
  });
});

// #189 timeline scrubber logic (Post your plan R-09.9, Host a party R-10.1).
import { describe, expect, test } from '@jest/globals';
import { HOUR, dayWord, MIN, STEP, clampCap, fit, hhmm, lenLabel, nightEnd, partyDefault, partyLimits, planDefault, planLimits, setEnd, slide, snap, ticks } from '../src/scene/timeWindow';

const at = (h: number, m = 0, dayOffset = 0) => {
  const d = new Date(2026, 10, 21 + dayOffset, h, m, 0, 0);
  return d.getTime();
};

describe('night end', () => {
  test('evening → next 06:00', () => expect(nightEnd(at(21, 40))).toBe(at(6, 0, 1)));
  test('after midnight → same morning 06:00', () => expect(nightEnd(at(2, 0))).toBe(at(6, 0)));
  test('less than 1 h before 06:00 → next day', () => expect(nightEnd(at(5, 30))).toBe(at(6, 0, 1)));
});

describe('snap', () => {
  const d = { min: at(21, 40), max: at(6, 0, 1) };
  test('near the start keeps "now"', () => expect(snap(at(21, 46), d)).toBe(d.min));
  test('otherwise a clock quarter', () => expect(snap(at(22, 8), d)).toBe(at(22, 15)));
  test('clamped to the domain', () => expect(snap(at(9, 0, 1), d)).toBe(d.max));
});

describe('post your plan', () => {
  const now = at(21, 40);
  const l = planLimits(now);
  test('default is now → +4 h (rounded to a quarter)', () => {
    const w = planDefault(now);
    expect(w.s).toBe(now);
    expect(w.e).toBe(at(1, 45, 1));
  });
  test('default shrinks near the end of the night', () => {
    const late = at(4, 0);
    const w = planDefault(late);
    expect(w.e).toBe(at(6, 0));
  });
  test('end never before start + 30 min, never past 06:00', () => {
    const w = planDefault(now);
    expect(setEnd(w, 'e', now, l).e).toBe(now + 30 * MIN);
    expect(setEnd(w, 'e', at(9, 0, 1), l).e).toBe(at(6, 0, 1));
  });
  test('start never after end − 30 min', () => {
    const w = { s: now, e: at(23, 0) };
    expect(setEnd(w, 's', at(23, 0), l).s).toBe(at(22, 30));
  });
  test('slide keeps the length and the domain', () => {
    const w = { s: now, e: now + 4 * HOUR };
    const moved = slide(w, at(5, 0, 1), l);
    expect(moved.e - moved.s).toBe(4 * HOUR);
    expect(moved.e).toBe(l.max);
    expect(slide(w, now - HOUR, l).s).toBe(now);
  });
});

describe('host a party', () => {
  const now = at(21, 40);
  test('tonight: starts at the next half hour + 30 min, 4 h', () => {
    const w = partyDefault(now, 'tonight');
    expect(hhmm(w.s)).toBe('22:30');
    expect(w.e - w.s).toBe(4 * HOUR);
  });
  test('daytime: defaults to 22:00 and shows at most 18 h', () => {
    const morning = at(11, 20);
    expect(partyDefault(morning, 'tonight').s).toBe(at(22, 0));
    const l = partyLimits(morning, 'tonight');
    expect(l.max - l.min).toBeLessThanOrEqual(18 * HOUR);
    expect(dayWord(morning, 'tonight')).toBe('today');
    expect(dayWord(now, 'tonight')).toBe('tonight');
  });
  test('tomorrow: 22:00, after tonight ends', () => {
    const w = partyDefault(now, 'tomorrow');
    expect(w.s).toBe(at(22, 0, 1));
    expect(w.s).toBeGreaterThanOrEqual(partyLimits(now, 'tomorrow').min);
  });
  test('length 1–12 h', () => {
    const l = partyLimits(now, 'tonight');
    const w = partyDefault(now, 'tonight');
    expect(setEnd(w, 'e', w.s, l).e - w.s).toBe(HOUR);
    expect(setEnd(w, 'e', w.s + 20 * HOUR, l).e - w.s).toBe(12 * HOUR);
    expect(setEnd({ s: w.s, e: w.s + 12 * HOUR }, 's', w.s - 2 * HOUR, l).s).toBe(w.s);
  });
  test('start times never go backwards (old bug: +24 h shown last as 11:00)', () => {
    const l = partyLimits(now, 'tonight');
    const t = ticks(l).map((x) => x.t);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
  test('fit brings a window into a new domain', () => {
    const l = partyLimits(now, 'tomorrow');
    const w = fit({ s: now, e: now + 4 * HOUR }, l);
    expect(w.s).toBe(l.min);
    expect(w.e - w.s).toBe(4 * HOUR);
  });
  test('guests 2–50', () => {
    expect(clampCap(1)).toBe(2);
    expect(clampCap(51)).toBe(50);
    expect(clampCap(6.4)).toBe(6);
  });
});

describe('labels', () => {
  test('length', () => {
    expect(lenLabel(4 * HOUR)).toBe('4 h');
    expect(lenLabel(90 * MIN)).toBe('1 h 30');
    expect(lenLabel(STEP * 3)).toBe('45 min');
  });
  test('ticks: labels every 2 h on a short domain, not on top of "now"', () => {
    const l = planLimits(at(21, 40));
    const labels = ticks(l).filter((x) => x.label).map((x) => hhmm(x.t));
    expect(labels).toEqual(['00:00', '02:00', '04:00', '06:00']);
  });
});

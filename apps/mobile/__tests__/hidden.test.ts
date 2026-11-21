import { describe, expect, it } from '@jest/globals';
import { backOf, hiddenExpired, stayOf, untilFor } from '../src/me/hidden';

// #114 F-05 R-05.7: Hidden absorbs Incognito (stay-hidden choices, return level).
describe('hidden', () => {
  const now = new Date(2026, 10, 21, 22, 15);

  it('untilFor', () => {
    expect(untilFor('manual', now)).toBeNull();
    expect(new Date(untilFor('1h', now)!).getTime() - now.getTime()).toBe(3600_000);
    expect(new Date(untilFor('24h', now)!).getTime() - now.getTime()).toBe(86_400_000);
    const m = new Date(untilFor('morning', now)!);
    expect([m.getDate(), m.getHours(), m.getMinutes()]).toEqual([22, 6, 0]);
    const early = new Date(2026, 10, 21, 3, 0);
    expect(new Date(untilFor('morning', early)!).getDate()).toBe(21);
  });

  it('stayOf round-trips', () => {
    for (const s of ['1h', 'morning', '24h', 'manual'] as const) expect(stayOf({ hidden_until: untilFor(s, now) }, now)).toBe(s);
  });

  it('hiddenExpired only for timed Hidden past its end', () => {
    expect(hiddenExpired({ hidden: true, hidden_until: null }, now)).toBe(false);
    expect(hiddenExpired({ hidden: false, hidden_until: '2000-01-01T00:00:00Z' }, now)).toBe(false);
    expect(hiddenExpired({ hidden: true, hidden_until: new Date(now.getTime() - 1).toISOString() }, now)).toBe(true);
    expect(hiddenExpired({ hidden: true, hidden_until: new Date(now.getTime() + 60_000).toISOString() }, now)).toBe(false);
  });

  it('backOf defaults to area', () => {
    expect(backOf({ hidden_return: null })).toBe('area');
    expect(backOf({ hidden_return: 'city' })).toBe('city');
  });
});

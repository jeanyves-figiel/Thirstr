import type { Me } from '../api/client';

// #114 F-05 R-05.7: Hidden absorbs Incognito. "Stay hidden" choices and "Then come back as".
export type Stay = '1h' | 'morning' | '24h' | 'manual';
export const STAYS: Stay[] = ['1h', 'morning', '24h', 'manual'];
export type Back = 'city' | 'area';

/** End time for a choice; 'morning' = next 6:00 local time; 'manual' = until I switch (null). */
export function untilFor(s: Stay, now: Date = new Date()): string | null {
  if (s === 'manual') return null;
  if (s === '1h') return new Date(now.getTime() + 3600_000).toISOString();
  if (s === '24h') return new Date(now.getTime() + 24 * 3600_000).toISOString();
  const t = new Date(now);
  t.setHours(6, 0, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.toISOString();
}

/** Best guess of the current choice from the stored end time (for the selected chip). */
export function stayOf(me: Pick<Me, 'hidden_until'>, now: Date = new Date()): Stay {
  if (!me.hidden_until) return 'manual';
  const left = new Date(me.hidden_until).getTime() - now.getTime();
  const at = new Date(me.hidden_until);
  if (at.getHours() === 6 && at.getMinutes() === 0) return 'morning';
  return left > 2 * 3600_000 ? '24h' : '1h';
}

/** True once a timed Hidden has passed its end: the app then applies the return level. */
export function hiddenExpired(me: Pick<Me, 'hidden' | 'hidden_until'>, now: Date = new Date()): boolean {
  return !!me.hidden && !!me.hidden_until && new Date(me.hidden_until).getTime() <= now.getTime();
}

export const backOf = (me: Pick<Me, 'hidden_return'>): Back => (me.hidden_return === 'city' ? 'city' : 'area');

import type { Mode } from '../api/types';

// F-24 Fit (#338, D-27, R-24.12). Runs on this phone only: the server sends the fields a viewer may
// already see (`card.match`, R-24.11); the score and its reasons are never sent or stored.
// Plain rules, no model, so every line of "Why you fit" is a fact the person can check.

export type Fields = Record<string, unknown>;

export type Reason =
  | { kind: 'position'; mine: string; his: string }
  | { kind: 'hosting'; mine: string; his: string }
  | { kind: 'when'; value: 'now' | 'tonight' }
  | { kind: 'interests'; items: string[] }
  | { kind: 'sports'; items: string[]; schedule: string[] }
  | { kind: 'tribes'; items: string[] }
  | { kind: 'no_clash' };

export type FitResult = {
  /** Shared interests + sports + tribes (the "N ♥" chip). */
  common: number;
  shared: { interests: string[]; sports: string[]; tribes: string[] };
  /** Hookup wants line up (position + hosting or timing, no hard-no clash). */
  fit: boolean;
  /** One of his practices is on my limits, or the other way round: never "Fit". */
  clash: boolean;
  reasons: Reason[];
  /** For Best fit and Picks ordering. */
  score: number;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const both = (a: string[], b: string[]) => a.filter((x) => b.includes(x));

// Position pairs that work together. Vers works with everyone; side only with side.
const GIVES: Record<string, number> = { top: 2, vers_top: 1, vers: 0, vers_bottom: -1, bottom: -2 };
export function positionsWork(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === 'side' || b === 'side') return a === 'side' && b === 'side';
  if (a === 'vers' || b === 'vers') return true;
  const x = GIVES[a];
  const y = GIVES[b];
  if (x === undefined || y === undefined) return false;
  // one leans top, the other leans bottom
  return (x > 0 && y < 0) || (x < 0 && y > 0);
}

/** One can host and the other can travel (either covers both sides). */
export function hostingWorks(a: string | null, b: string | null): boolean {
  if (!a || !b || a === 'neither' || b === 'neither') return false;
  const host = (h: string) => h === 'can_host' || h === 'either';
  const travel = (h: string) => h === 'can_travel' || h === 'either';
  return (host(a) && travel(b)) || (travel(a) && host(b));
}

const TIMING = ['now', 'tonight'] as const;

/**
 * `mine` = my own fields (server values + values kept on this phone, R-06.4).
 * `his` = `card.match` or the visible fields of his profile. `lens` = the card's lens.
 */
export function fitOf(mine: Fields, his: Fields | null | undefined, lens: Mode): FitResult {
  const h = his ?? {};
  const interests = both(arr(mine.interests), arr(h.interests));
  const sports = lens === 'friends' ? [] : both(arr(mine.sports), arr(h.sports));
  const schedule = sports.length ? both(arr(mine.schedule), arr(h.schedule)) : [];
  const tribes = lens === 'sport' ? [] : both(arr(mine.tribes), arr(h.tribes));
  const reasons: Reason[] = [];

  let fit = false;
  let clash = false;
  let hookupPoints = 0;
  if (lens === 'hookup') {
    const myLimits = arr(mine.limits);
    const hisLimits = arr(h.limits);
    clash = arr(h.practices).some((p) => myLimits.includes(p)) || arr(mine.practices).some((p) => hisLimits.includes(p));
    const mp = str(mine.position);
    const hp = str(h.position);
    const mh = str(mine.hosting);
    const hh = str(h.hosting);
    const pos = positionsWork(mp, hp);
    const host = hostingWorks(mh, hh);
    const when = TIMING.find((t) => arr(mine.looking_for).includes(t) && arr(h.looking_for).includes(t)) ?? null;
    if (pos && mp && hp) reasons.push({ kind: 'position', mine: mp, his: hp });
    if (host && mh && hh) reasons.push({ kind: 'hosting', mine: mh, his: hh });
    if (when) reasons.push({ kind: 'when', value: when });
    fit = !clash && pos && (host || !!when);
    hookupPoints = (pos ? 3 : 0) + (host ? 2 : 0) + (when ? 2 : 0) - (clash ? 6 : 0);
  }
  if (interests.length) reasons.push({ kind: 'interests', items: interests });
  if (sports.length) reasons.push({ kind: 'sports', items: sports, schedule });
  if (tribes.length) reasons.push({ kind: 'tribes', items: tribes });
  if (fit && arr(mine.limits).length) reasons.push({ kind: 'no_clash' });

  const common = interests.length + sports.length + tribes.length;
  const score = hookupPoints + interests.length * 1.5 + sports.length * 1.2 + schedule.length * 0.3 + tribes.length * 0.8 + (fit ? 2 : 0);
  return { common, shared: { interests, sports, tribes }, fit, clash, reasons, score };
}

/** R-24.13 Best fit: higher score first; ties keep the server's nearest-first order. */
export function bestFitOrder<T extends { id: string }>(items: T[], scoreOf: (x: T) => number): T[] {
  return items
    .map((x, i) => ({ x, i, s: scoreOf(x) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.x);
}

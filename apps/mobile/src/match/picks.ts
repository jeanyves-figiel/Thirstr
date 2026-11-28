import type { Distance, Mode } from '../api/types';
import { privateStore as AsyncStorage } from '../app/privateStore';
import { fitOf, type Fields, type FitResult } from './fit';

// F-24 Picks (#338, D-27, R-24.20–R-24.25). A small ranker on this phone: Fit (R-24.12) plus weights
// learned from what I do (taps, favourites, chats, "Less like this"). Candidates are only people the
// grid already returned (R-24.21): no extra request. Weights and history never leave the phone
// (P-5, AC-24.4); "Forget everything learned" wipes them (R-24.24).

export type Person = {
  id: string;
  age: number;
  verified?: boolean;
  online?: boolean;
  now?: unknown;
  distance?: Distance;
  intents?: Mode[];
  /** card.match or a profile's visible fields */
  match?: Fields | null;
};

// ---- features (≈ 40): fit parts + simple, explainable traits
export const AGE_BANDS = [
  [18, 24],
  [25, 29],
  [30, 34],
  [35, 39],
  [40, 44],
  [45, 54],
  [55, 99],
] as const;
export const TRIBES = ['bear', 'twink', 'jock', 'otter', 'daddy', 'geek', 'leather', 'pup', 'rugged', 'trans', 'clean_cut', 'chub', 'muscle', 'discreet'];
export const BUILDS = ['slim', 'fit', 'muscular', 'average', 'stocky', 'large'];
export const NEAR = ['lt1k', 'lt3k', 'lt10k', 'far'] as const;

export type Feature =
  | { k: 'bias' }
  | { k: 'fit' }
  | { k: 'common' }
  | { k: 'age'; band: number }
  | { k: 'tribe'; v: string }
  | { k: 'build'; v: string }
  | { k: 'near'; v: (typeof NEAR)[number] }
  | { k: 'online' }
  | { k: 'now' }
  | { k: 'verified' };

export const FEATURES: Feature[] = [
  { k: 'bias' },
  { k: 'fit' },
  { k: 'common' },
  ...AGE_BANDS.map((_, band) => ({ k: 'age' as const, band })),
  ...TRIBES.map((v) => ({ k: 'tribe' as const, v })),
  ...BUILDS.map((v) => ({ k: 'build' as const, v })),
  ...NEAR.map((v) => ({ k: 'near' as const, v })),
  { k: 'online' },
  { k: 'now' },
  { k: 'verified' },
];
export const N = FEATURES.length;

export function metres(d: Distance | undefined): number | null {
  if (!d) return null;
  if (d.kind === 'exact') return d.m;
  if (d.kind === 'area') {
    if (typeof d.m === 'number') return d.m;
    const b: Record<string, number> = { lt200: 150, '200_500': 400, '500_1k': 800, '1_2k': 1500, '2_5k': 3500, '5_10k': 7500, '10k_plus': 15000 };
    return b[d.bucket] ?? null;
  }
  return null;
}

export function featuresOf(p: Person, fit: FitResult): number[] {
  const x = new Array<number>(N).fill(0);
  const m = p.match ?? {};
  const tribes = Array.isArray(m.tribes) ? (m.tribes as string[]) : [];
  const build = typeof m.build === 'string' ? m.build : null;
  const d = metres(p.distance);
  const near = d === null ? 'far' : d < 1000 ? 'lt1k' : d < 3000 ? 'lt3k' : d < 10000 ? 'lt10k' : 'far';
  FEATURES.forEach((f, i) => {
    switch (f.k) {
      case 'bias':
        x[i] = 1;
        break;
      case 'fit':
        x[i] = fit.fit ? 1 : 0;
        break;
      case 'common':
        x[i] = Math.min(fit.common, 6) / 6;
        break;
      case 'age':
        x[i] = p.age >= AGE_BANDS[f.band][0] && p.age <= AGE_BANDS[f.band][1] ? 1 : 0;
        break;
      case 'tribe':
        x[i] = tribes.includes(f.v) ? 1 : 0;
        break;
      case 'build':
        x[i] = build === f.v ? 1 : 0;
        break;
      case 'near':
        x[i] = near === f.v ? 1 : 0;
        break;
      case 'online':
        x[i] = p.online ? 1 : 0;
        break;
      case 'now':
        x[i] = p.now ? 1 : 0;
        break;
      case 'verified':
        x[i] = p.verified ? 1 : 0;
        break;
    }
  });
  return x;
}

// ---- model (logistic regression, trained on this phone)
export type Model = { w: number[]; n: number };
export const PRIOR: number[] = FEATURES.map((f) => (f.k === 'fit' ? 1.2 : f.k === 'common' ? 1.0 : f.k === 'near' && f.v === 'lt1k' ? 0.3 : f.k === 'online' ? 0.3 : 0));
export const emptyModel = (): Model => ({ w: PRIOR.slice(), n: 0 });

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const scoreOf = (m: Model, x: number[]) => x.reduce((s, v, i) => s + v * (m.w[i] ?? 0), 0);

export type Signal = 'tap' | 'favorite' | 'message' | 'reply' | 'less' | 'not_for_me';
const LABEL: Record<Signal, { y: number; lr: number }> = {
  tap: { y: 1, lr: 0.15 },
  favorite: { y: 1, lr: 0.2 },
  message: { y: 1, lr: 0.25 },
  reply: { y: 1, lr: 0.35 },
  less: { y: 0, lr: 0.4 },
  not_for_me: { y: 0, lr: 0.2 },
};

/** One SGD step towards the signal; the prior on fit/common decays slowly but never flips sign. */
export function learn(m: Model, x: number[], s: Signal): Model {
  const { y, lr } = LABEL[s];
  const p = sigmoid(scoreOf(m, x));
  const g = y - p;
  const w = m.w.map((wi, i) => {
    const next = wi + lr * g * x[i] - 0.002 * (wi - PRIOR[i]);
    return Math.max(-4, Math.min(4, next));
  });
  return { w, n: m.n + 1 };
}

// ---- explain (R-24.23, R-24.24)
export type Learned = { kind: 'age'; band: number } | { kind: 'tribe'; v: string } | { kind: 'build'; v: string } | { kind: 'near'; v: string } | { kind: 'online' };

const LEARN_MIN = 0.35;

/** Traits Picks learned to like, strongest first (only after a few signals). */
export function learnedTraits(m: Model, max = 4): Learned[] {
  if (m.n < 3) return [];
  return FEATURES.map((f, i) => ({ f, w: m.w[i] - PRIOR[i] }))
    .filter(({ f, w }) => w >= LEARN_MIN && ['age', 'tribe', 'build', 'near', 'online'].includes(f.k))
    .sort((a, b) => b.w - a.w)
    .slice(0, max)
    .map(({ f }) =>
      f.k === 'age' ? { kind: 'age', band: f.band } : f.k === 'tribe' ? { kind: 'tribe', v: f.v } : f.k === 'build' ? { kind: 'build', v: f.v } : f.k === 'near' ? { kind: 'near', v: f.v } : { kind: 'online' },
    );
}

/** Learned traits this person has (for the third reason line on a pick). */
export function learnedFor(m: Model, x: number[]): Learned[] {
  const mine = learnedTraits(m, 8);
  return mine.filter((t) => {
    const i = FEATURES.findIndex((f) =>
      t.kind === 'age' ? f.k === 'age' && f.band === t.band : t.kind === 'online' ? f.k === 'online' : f.k === t.kind && 'v' in f && f.v === (t as { v: string }).v,
    );
    return i >= 0 && x[i] > 0;
  }).slice(0, 2);
}

// ---- windows (R-24.20): 07:00 and 19:00 local
export function windowOf(now: Date): { key: string; next: Date } {
  const h = now.getHours();
  const d = new Date(now);
  let start: Date;
  let next: Date;
  if (h >= 19) {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19);
    next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 7);
  } else if (h >= 7) {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7);
    next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 19);
  } else {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 19);
    next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 7);
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return { key: `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}T${p(start.getHours())}`, next };
}

// ---- state on the phone
export type PicksState = {
  model: Model;
  /** id → ms until which he is not picked again (7 d after a pick, 30 d after Not for me). */
  cooldown: Record<string, number>;
  window: string | null;
  ids: string[];
  /** How many were picked in this window (the done card counts them). */
  n?: number;
  refreshedAt: number;
};
const KEY = 'thirstr.picks.v1';
const WEEK = 7 * 86_400_000;
const MONTH = 30 * 86_400_000;
export const HOUR = 3_600_000;

export const emptyState = (): PicksState => ({ model: emptyModel(), cooldown: {}, window: null, ids: [], refreshedAt: 0 });

export async function loadState(): Promise<PicksState> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (!s) return emptyState();
    const v = JSON.parse(s) as PicksState;
    if (!Array.isArray(v.model?.w) || v.model.w.length !== N) v.model = emptyModel();
    return { ...emptyState(), ...v };
  } catch {
    return emptyState();
  }
}

export async function saveState(s: PicksState): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => {});
}

/** R-24.24 Forget everything learned. */
export async function forget(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

export type Pick = { person: Person; fit: FitResult; learned: Learned[]; score: number };

/**
 * Chooses up to `n` picks from the grid's people. Never: people in cooldown, people I already chat
 * with (`excluded`), anyone whose Fit is off (`fitVisible` false → no Fit inputs → `match` null).
 */
export function choose(state: PicksState, people: Person[], self: Fields, n: number, excluded: (id: string) => boolean, now = Date.now()): Pick[] {
  const out: Pick[] = [];
  for (const p of people) {
    if (!p.match || excluded(p.id) || (state.cooldown[p.id] ?? 0) > now) continue;
    const lens: Mode = p.intents?.[0] ?? 'hookup';
    const fit = fitOf(self, p.match, lens);
    if (fit.clash) continue;
    const x = featuresOf(p, fit);
    out.push({ person: p, fit, learned: learnedFor(state.model, x), score: scoreOf(state.model, x) + fit.score * 0.15 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

/** After picking: cool these people down for a week. */
export function markPicked(state: PicksState, ids: string[], windowKey: string, now = Date.now()): PicksState {
  const cooldown = { ...pruneCooldown(state.cooldown, now) };
  for (const id of ids) cooldown[id] = Math.max(cooldown[id] ?? 0, now + WEEK);
  return { ...state, cooldown, window: windowKey, ids, n: ids.length, refreshedAt: now };
}

export function notForMe(state: PicksState, id: string, now = Date.now()): PicksState {
  return { ...state, cooldown: { ...state.cooldown, [id]: now + MONTH }, ids: state.ids.filter((x) => x !== id) };
}

function pruneCooldown(c: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) if (v > now) out[k] = v;
  return out;
}

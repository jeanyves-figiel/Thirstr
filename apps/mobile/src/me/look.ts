import type { Mode, MyProfile, Visibility } from '../api/types';
import { inLens, lensPhoto } from '../profile/lens';

// S-66 "How others see you" (#114, F-06 R-06.7, R-06.7a): what a viewer browsing a lens does NOT see.
export type Audience = 'stranger' | 'verified' | 'chats';
export const AUDIENCES: Audience[] = ['stranger', 'verified', 'chats'];

export type MissingKind = 'photos' | 'lens' | 'verified' | 'chats' | 'only_me' | 'albums';
export type Missing = { kind: MissingKind; keys: string[]; count: number };

export function allowedFor(as: Audience): Visibility[] {
  return as === 'stranger' ? ['public'] : as === 'verified' ? ['public', 'verified'] : ['public', 'verified', 'chats'];
}

const filled = (v: unknown) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));

/**
 * Ordered list of what `as` misses in `mode`. Each field is counted once, by its first reason:
 * the lens hides it, else its visibility does. Private albums are always listed (shared one by one).
 * `local` = "My chats" values kept on the phone (R-06.5).
 */
export function whatTheyMiss(p: MyProfile, as: Audience, mode: Mode, local: Record<string, unknown> = {}): Missing[] {
  const out: Missing[] = [];
  const live = p.photos.filter((x) => x.url && x.status !== 'rejected');
  const spicy = live.filter((x) => !lensPhoto(x, mode)).length;
  if (spicy) out.push({ kind: 'photos', keys: [], count: spicy });

  const all: Record<string, unknown> = { ...p.fields, ...local };
  const allowed = allowedFor(as);
  const lens: string[] = [];
  const byVis: Record<'verified' | 'chats' | 'only_me', string[]> = { verified: [], chats: [], only_me: [] };
  for (const [k, v] of Object.entries(all)) {
    if (!filled(v)) continue;
    if (!inLens(k, mode)) {
      lens.push(k);
      continue;
    }
    const vis = p.visibility_map[k] ?? 'public';
    if (vis !== 'public' && !allowed.includes(vis)) byVis[vis].push(k);
  }
  if (lens.length) out.push({ kind: 'lens', keys: lens, count: lens.length });
  for (const kind of ['verified', 'chats', 'only_me'] as const) if (byVis[kind].length) out.push({ kind, keys: byVis[kind], count: byVis[kind].length });
  out.push({ kind: 'albums', keys: [], count: 0 });
  return out;
}

/** Next value in a fixed cycle (the full-screen "Seen by … in …" pills). */
export function cycle<T>(list: readonly T[], v: T): T {
  return list[(list.indexOf(v) + 1) % list.length];
}

// #219 R-06.8a: the missing R-06.8 items with the biggest completeness gain, so Edit profile says
// what to do next. Mirrors Thirstr.Profiles.Fields.completeness/1 (server value stays the truth).
import type { Mode } from '../api/types';
import { filled, sectionOf, type SectionId } from './sections';

export type WinId = 'main_photo' | 'photos' | 'bio' | 'languages' | 'body' | 'looking_for' | 'hookup' | 'sport' | 'prompt';
export type Win = { id: WinId; gain: number; count?: number; target: { kind: 'photos' } | { kind: 'field'; section: SectionId; key: string } };

const field = (key: string) => ({ kind: 'field' as const, section: sectionOf(key), key });

export function quickWins(fields: Record<string, unknown>, photos: number, showIn: Mode[], limit = 3): Win[] {
  const has = (k: string) => filled(fields[k]);
  const out: Win[] = [];
  if (photos < 1) out.push({ id: 'main_photo', gain: 20, target: { kind: 'photos' } });
  const extra = Math.min(Math.max(photos - 1, 0), 4);
  if (extra < 4) out.push({ id: 'photos', gain: Math.round((10 * (4 - extra)) / 4), count: 4 - extra, target: { kind: 'photos' } });
  if (!has('bio')) out.push({ id: 'bio', gain: 10, target: field('bio') });
  if (!has('languages')) out.push({ id: 'languages', gain: 10, target: field('languages') });
  const body = ['height_cm', 'build'].filter((k) => !has(k));
  if (body.length) out.push({ id: 'body', gain: 5 * body.length, target: field(body[0]) });
  const hookup = showIn.includes('hookup');
  const lensKeys = hookup ? ['position', 'hosting'] : ['sports', 'sport_level', 'schedule'];
  const lensMissing = lensKeys.filter((k) => !has(k));
  if (lensMissing.length) out.push({ id: hookup ? 'hookup' : 'sport', gain: Math.round((10 * lensMissing.length) / lensKeys.length), target: field(lensMissing[0]) });
  if (!has('looking_for') && !has('sport_intent')) out.push({ id: 'looking_for', gain: 5, target: field(hookup ? 'looking_for' : 'sport_intent') });
  if (!has('prompt_a')) out.push({ id: 'prompt', gain: 5, target: field('prompt_q') });
  // Stable sort: equal gains keep the order above (photos, bio, languages, body, lens, looking for, prompt).
  return out
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.gain - a.w.gain || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.w);
}

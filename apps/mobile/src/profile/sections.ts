// #219 R-06.8b: Edit profile sections (S-74 rows, S-75 pages). Basics also edits the display name.
import type { Mode } from '../api/types';
import { GROUPS } from './fieldMeta';

export type SectionId = 'basics' | 'about' | 'body' | 'hookup' | 'health' | 'sport';

const group = (g: string) => GROUPS.find((x) => x.group === g)?.keys ?? [];

export const SECTIONS: { id: SectionId; keys: string[]; lens?: Mode; group: string }[] = [
  { id: 'basics', keys: ['pronouns', 'orientation', 'languages'], group: 'about' },
  { id: 'about', keys: ['bio', 'prompt_q', 'prompt_a', 'looking_for', 'relationship'], group: 'about' },
  { id: 'body', keys: group('body'), group: 'body' },
  { id: 'hookup', keys: group('hookup'), lens: 'hookup', group: 'hookup' },
  { id: 'health', keys: group('health'), group: 'health' },
  { id: 'sport', keys: group('sport'), lens: 'sport', group: 'sport' },
];

export const sectionOf = (key: string): SectionId => SECTIONS.find((s) => s.keys.includes(key))?.id ?? 'about';

/** A value counts as filled when it is not empty; false switches count as answered. */
export function filled(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Keys the server knows about (options.defaults), so counts never include fields this build lacks. */
export function sectionKeys(id: SectionId, known: (k: string) => boolean): string[] {
  return (SECTIONS.find((s) => s.id === id)?.keys ?? []).filter(known);
}

export function nextSection(id: SectionId): SectionId | null {
  const i = SECTIONS.findIndex((s) => s.id === id);
  return i >= 0 && i < SECTIONS.length - 1 ? SECTIONS[i + 1].id : null;
}

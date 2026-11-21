// Client mirror of Thirstr.Profiles.Fields types (server validates; this drives inputs).
export type FieldType = 'enum' | 'multi' | 'text' | 'int' | 'bool' | 'month';

const MULTI = ['languages', 'tribes', 'looking_for', 'practices', 'limits', 'sports', 'schedule'];
const BOOL = ['creator', 'groups', 'clubs_visible'];
const INT = ['height_cm', 'weight_kg'];
const TEXT = ['pronouns', 'bio', 'prompt_a', 'boundaries', 'gym'];
const MAXLEN: Record<string, number> = { pronouns: 20, bio: 300, prompt_a: 150, boundaries: 200, gym: 60 };

export function fieldType(k: string): FieldType {
  if (MULTI.includes(k)) return 'multi';
  if (BOOL.includes(k)) return 'bool';
  if (INT.includes(k)) return 'int';
  if (TEXT.includes(k)) return 'text';
  if (k === 'last_tested') return 'month';
  return 'enum';
}

export const maxLen = (k: string) => MAXLEN[k] ?? 60;
export const optionKey = (k: string) => (k === 'limits' ? 'practices' : k);

export type Group = 'about' | 'body' | 'hookup' | 'health' | 'sport';
export const GROUPS: { group: Group; keys: string[] }[] = [
  { group: 'about', keys: ['pronouns', 'orientation', 'languages', 'bio', 'prompt_q', 'prompt_a', 'looking_for', 'relationship'] },
  { group: 'body', keys: ['height_cm', 'weight_kg', 'build', 'body_hair', 'beard', 'tribes'] },
  { group: 'hookup', keys: ['position', 'practices', 'limits', 'hosting', 'groups', 'boundaries', 'creator'] },
  { group: 'health', keys: ['prep', 'hiv', 'last_tested'] },
  { group: 'sport', keys: ['sports', 'sport_level', 'gym', 'schedule', 'sport_intent', 'clubs_visible'] },
];

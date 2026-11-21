import type { Mode } from '../api/types';
import { GROUPS } from './fieldMeta';

// Client mirror of Thirstr.Profiles.Fields.lens/2 (F-06 R-06.1b). The server enforces it on
// every read; the app uses it for the Me preview and "Preview as".
const HOOKUP_ONLY = new Set([...GROUPS.find((g) => g.group === 'hookup')!.keys, ...GROUPS.find((g) => g.group === 'health')!.keys]);
const SPORT = new Set(GROUPS.find((g) => g.group === 'sport')!.keys);
// Body/about fields kept by the Hookup lens only (catalogue kinds ~w(now)).
const HOOKUP_LOOKING_FOR = ['hookup', 'now', 'tonight'];

export const LENSES: Mode[] = ['hookup', 'friends', 'sport'];

export function inLens(key: string, mode: Mode): boolean {
  if (mode === 'hookup') return true;
  if (HOOKUP_ONLY.has(key)) return false;
  if (SPORT.has(key)) return mode === 'sport';
  return true;
}

export function lensFields(fields: Record<string, unknown>, mode: Mode): Record<string, unknown> {
  if (mode === 'hookup') return fields;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!inLens(k, mode)) continue;
    if (k === 'looking_for' && Array.isArray(v)) {
      const rest = v.filter((x) => !HOOKUP_LOOKING_FOR.includes(String(x)));
      if (rest.length) out[k] = rest;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Photos a lens shows: Friends and Sport only show strict-safe (`main_ok`) photos (R-06.3). */
export function lensPhoto(p: { main_ok?: boolean; slot: number }, mode: Mode): boolean {
  return mode === 'hookup' || p.slot === 0 || p.main_ok === true;
}

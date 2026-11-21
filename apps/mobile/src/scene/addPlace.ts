// #191 Add a place (F-12 R-12.11): pure rules shared by the screen and tests.
export type Fix = { lat: number; lng: number; accuracy: number };
export const PLACE_KINDS = ['club', 'bar', 'sauna', 'gym', 'other'];
// Above this the pin could land next door: ask for a better fix.
export const MAX_ACCURACY_M = 100;

export function canAdd(name: string, kind: string | null, fix: Fix | null) {
  return name.trim().length >= 2 && name.trim().length <= 60 && !!kind && PLACE_KINDS.includes(kind) && !!fix && fix.accuracy <= MAX_ACCURACY_M;
}

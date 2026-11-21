import { NOTES, type Lang, type Note } from './notes';

// F-17 R-17.15 (#238): which note to show, if any. Pure so it is unit tested.
// lastSeen: id stored on this phone (null = never stored).
// upgraded: this phone had app data from an earlier version (null lastSeen + no data = fresh install).
export function pickNote(lastSeen: number | null, upgraded: boolean, notes: Note[] = NOTES): { note: Note | null; earlier: number; latest: number } {
  const latest = notes[0]?.id ?? 0;
  if (lastSeen == null && !upgraded) return { note: null, earlier: 0, latest };
  const seen = lastSeen ?? 0;
  const fresh = notes.filter((n) => n.id > seen);
  return { note: fresh[0] ?? null, earlier: Math.max(0, fresh.length - 1), latest };
}

export function langOf(code: string | null | undefined): Lang {
  return code === 'fr' || code === 'de' ? code : 'en';
}

// F-19 (#187): pure gesture maths, shared by the UI-thread worklets and the tests.

/** R-19.6: a drag commits past `frac` of `size` or on a fling faster than `fling` pt/s in its direction. */
export function commits(t: number, v: number, size: number, frac = 0.3, fling = 800): boolean {
  'worklet';
  if (t === 0) return false;
  const dir = Math.sign(t);
  return Math.abs(t) >= size * frac || (v * dir > fling && Math.abs(t) > 12);
}

/** iOS-like rubber band past a limit: the further you pull, the less it moves. */
export function rubber(over: number, dim = 120): number {
  'worklet';
  const s = Math.sign(over);
  const a = Math.abs(over);
  return s * ((a * dim * 0.55) / (dim + a * 0.55));
}

/** F-19: a tap fails once the finger moves this far, so swipes and pans win straight away. */
export const TAP_SLOP = 10;

export const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** G8: grid columns after a pinch. Pinch out (> 1.25) = bigger tiles = fewer columns. */
export function colsAfterPinch(cols: number, scale: number): 2 | 3 | 4 {
  'worklet';
  const c = scale > 1.25 ? cols - 1 : scale < 0.8 ? cols + 1 : cols;
  return Math.min(4, Math.max(2, c)) as 2 | 3 | 4;
}

/** G9: a tap on the left 35 % of the photo goes back, anywhere else goes forward (story style). */
export function photoZone(x: number, width: number): -1 | 1 {
  'worklet';
  return x < width * 0.35 ? -1 : 1;
}

/** G10: next index after a horizontal profile swipe; stays put at the ends (bounce). */
export function nextIndex(i: number, len: number, dir: -1 | 1): number {
  'worklet';
  const n = i + dir;
  return n < 0 || n >= len ? i : n;
}

/** G10: up to 100 ids on each side of `id`, in list order (the grid order a profile swipes through). */
export function nearIds(items: { id: string }[] | null, id: string): string[] {
  if (!items) return [id];
  const i = items.findIndex((c) => c.id === id);
  if (i < 0) return [id];
  return items.slice(Math.max(0, i - 100), i + 101).map((c) => c.id);
}

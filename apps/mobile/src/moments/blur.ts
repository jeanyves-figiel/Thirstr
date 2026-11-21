// F-21 R-21.2 (#221, D-21c A): Blur tool state. Pure, unit-tested; drawing lives in BlurCanvas.
// Coordinates are normalized to the cropped frame (0…1 of its width / height), so the same marks
// draw the on-screen preview and the full-size photo that is uploaded.

/** One blurred ellipse: centre (x, y) and radii (rx of the width, ry of the height). */
export type Spot = { x: number; y: number; rx: number; ry: number };
export type Face = { spot: Spot; on: boolean };
export type Step = { t: 'stroke' } | { t: 'faces'; ids: number[] };
export type BlurState = { strokes: Spot[][]; faces: Face[] | null; keepMine: boolean; history: Step[] };

export const BRUSH = { s: 0.035, m: 0.06, l: 0.1 } as const;
export type Brush = keyof typeof BRUSH;

export const empty = (): BlurState => ({ strokes: [], faces: null, keepMine: true, history: [] });

/** Every ellipse to blur, strokes first. */
export const spots = (s: BlurState): Spot[] => [...s.strokes.flat(), ...(s.faces ?? []).filter((f) => f.on).map((f) => f.spot)];

/** How many separate areas are blurred (a stroke counts once). */
export const count = (s: BlurState) => s.strokes.length + (s.faces ?? []).filter((f) => f.on).length;

/** A new finger stroke starts at (x, y) in frame units; `aspect` = frame width / height. */
export function begin(s: BlurState, x: number, y: number, brush: Brush, aspect: number): BlurState {
  const r = BRUSH[brush];
  return { ...s, strokes: [...s.strokes, [{ x, y, rx: r, ry: r * aspect }]], history: [...s.history, { t: 'stroke' }] };
}

/** Adds dabs along the stroke so it stays continuous (one dab every half radius). */
export function extend(s: BlurState, x: number, y: number, brush: Brush, aspect: number): BlurState {
  const cur = s.strokes[s.strokes.length - 1];
  if (!cur) return begin(s, x, y, brush, aspect);
  const last = cur[cur.length - 1];
  const r = BRUSH[brush];
  const dx = x - last.x;
  const dy = (y - last.y) / aspect;
  const dist = Math.hypot(dx, dy);
  const stepLen = r / 2;
  if (dist < stepLen) return s;
  const n = Math.min(40, Math.floor(dist / stepLen));
  const add: Spot[] = [];
  for (let i = 1; i <= n; i++) add.push({ x: last.x + (dx * i) / n, y: last.y + ((y - last.y) * i) / n, rx: r, ry: r * aspect });
  return { ...s, strokes: [...s.strokes.slice(0, -1), [...cur, ...add].slice(0, 2000)] };
}

/**
 * Face boxes [x, y, w, h] (0…1, largest first) → ellipses a little larger than the box, so hair
 * line and chin are covered too.
 */
export const facesFrom = (boxes: number[][]): Face[] =>
  boxes.map(([x, y, w, h]) => ({ spot: { x: x + w / 2, y: y + h / 2, rx: (w / 2) * 1.35, ry: (h / 2) * 1.45 }, on: false }));

/** "Blur faces": every face on, except the largest (the poster's own) while Keep mine is on. */
export function blurFaces(s: BlurState, faces: Face[] = s.faces ?? []): BlurState {
  const ids = faces.map((_, i) => i).filter((i) => !faces[i].on && !(s.keepMine && i === 0 && faces.length > 1));
  if (!ids.length) return { ...s, faces };
  return { ...s, faces: faces.map((f, i) => (ids.includes(i) ? { ...f, on: true } : f)), history: [...s.history, { t: 'faces', ids }] };
}

/** Keep mine on → the largest face turns sharp; off → it is blurred too once faces were blurred. */
export function setKeepMine(s: BlurState, keep: boolean): BlurState {
  const faces = s.faces;
  if (!faces?.length) return { ...s, keepMine: keep };
  const applied = faces.some((f) => f.on);
  if (keep && faces.length > 1) {
    // Face 0 is sharp again: its blur steps leave the undo history too.
    const history = s.history.map((h) => (h.t === 'faces' ? { ...h, ids: h.ids.filter((i) => i !== 0) } : h)).filter((h) => h.t !== 'faces' || h.ids.length);
    return { ...s, keepMine: true, faces: faces.map((f, i) => (i === 0 ? { ...f, on: false } : f)), history };
  }
  if (keep) return { ...s, keepMine: true };
  return applied && !faces[0].on ? { ...s, keepMine: false, faces: faces.map((f, i) => (i === 0 ? { ...f, on: true } : f)), history: [...s.history, { t: 'faces', ids: [0] }] } : { ...s, keepMine: false };
}

/** Tap on a blurred face makes just that one sharp again. */
export const toggleFace = (s: BlurState, i: number): BlurState => (s.faces?.[i] ? { ...s, faces: s.faces.map((f, k) => (k === i ? { ...f, on: !f.on } : f)) } : s);

/** Undo: one stroke or one "Blur faces" step back. */
export function undo(s: BlurState): BlurState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;
  const history = s.history.slice(0, -1);
  if (last.t === 'stroke') return { ...s, strokes: s.strokes.slice(0, -1), history };
  return { ...s, faces: (s.faces ?? []).map((f, i) => (last.ids.includes(i) ? { ...f, on: false } : f)), history };
}

/** Index of the face under a tap (frame units), or -1. */
export function faceAt(s: BlurState, x: number, y: number): number {
  return (s.faces ?? []).findIndex((f) => ((x - f.spot.x) / f.spot.rx) ** 2 + ((y - f.spot.y) / f.spot.ry) ** 2 <= 1);
}

/** Blur strength for an image of this width: strong enough that a face can't be recognised. */
export const sigmaFor = (width: number) => Math.max(8, width * 0.03);

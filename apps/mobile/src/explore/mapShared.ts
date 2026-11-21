import { cellToLatLng } from 'h3-js';
import { API_BASE } from '../api/client';
import type { Card, MapData, Mode, Place } from '../api/types';
import { modeColor } from '../theme/tokens';

// Tiles + style come through our API (/v1/tiles), never a third-party host (I-03).
export const STYLE_URL = API_BASE + '/tiles/style.json';

export type MapProps = {
  /** Where to centre (R-04.13); zoom defaults to START_ZOOM. */
  center: { lat: number; lng: number; zoom?: number } | null;
  me: { lat: number; lng: number } | null;
  /** Bump to recentre on `center` (Locate me). */
  recenter: number;
  data: MapData | null;
  accent: string;
  onRegion: (bbox: [number, number, number, number]) => void;
  /** Tap on a pin: the screen selects it, or opens the profile when already selected (R-04.14). */
  onSelect: (card: Card) => void;
  /** R-04.14: long-press on a person's pin → safety sheet (S-21). */
  onHold?: (card: Card) => void;
  /** Tap on the map away from pins: clears the selection. */
  onClear?: () => void;
  /** Selected pin (grown, name chip). */
  selected?: string | null;
  /** R-04.20 place markers (already filtered by the chips). */
  places?: Place[];
  onPlace?: (p: Place) => void;
  selectedPlace?: string | null;
  /** F-20 R-20.11: one sky "N visiting" bubble at the trip city centre (faces only for verified viewers). */
  visiting?: { lat: number; lng: number; count: number; faces: (string | null)[] } | null;
  onVisiting?: () => void;
};

/** R-04.19 screen-reader label: "Sam, 31, looking for Hookup and Friends, 400 m". */
export function pinLabel(c: Card, names: Record<Mode, string>, and: string, dist: string, fmt: (who: string, list: string, dist: string) => string): string {
  const list = INTENTS.filter((m) => (c.intents ?? []).includes(m)).map((m) => names[m]);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} ${and} ${list[list.length - 1]}` : (list[0] ?? names.hookup);
  return fmt(`${c.display_name}, ${c.age}`, joined, dist);
}

/** Start zoom: a few r7 cells fit on screen. */
export const START_ZOOM = 12;

/** Count labels at cell centres (max 40), shown where the server gives counts, not people. */
export function cellLabels(data: MapData | null): { key: string; lat: number; lng: number; label: string }[] {
  return (data?.cells ?? [])
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
    .map((c) => {
      const [lat, lng] = cellToLatLng(c.cell);
      return { key: c.cell, lat, lng, label: c.count > 999 ? `${Math.floor(c.count / 1000)}k+` : String(c.count) };
    });
}

export function initial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/** MapLibre metres per pixel at zoom 0 on the equator (512 px tiles). */
const M_PER_PX_Z0 = 78271.517;
const FIT_MIN = 9;
const FIT_MAX = 15;

/**
 * R-04.15 auto-fit: camera that shows a circle of `fitM` metres around `p` inside the map area
 * above the sheet. The map is `w`×`h`; the sheet covers its bottom `sheet` px, so the camera
 * centre moves south by half the sheet to keep `p` in the middle of the visible part. `top` = px
 * covered by the floating header (#113).
 */
export function fitCamera(p: { lat: number; lng: number }, fitM: number | null | undefined, w: number, h: number, sheet: number, top = 0): { lat: number; lng: number; zoom: number } {
  const visible = Math.max(120, h - sheet - top);
  const cos = Math.cos((p.lat * Math.PI) / 180);
  let zoom = START_ZOOM;
  if (fitM && fitM > 0) {
    const px = Math.max(60, Math.min(w, visible) / 2 - 28);
    zoom = Math.log2((M_PER_PX_Z0 * cos * px) / fitM);
    zoom = Math.min(FIT_MAX, Math.max(FIT_MIN, Math.round(zoom * 4) / 4));
  }
  const mpp = (M_PER_PX_Z0 * cos) / 2 ** zoom;
  // #113: the floating header covers the top `top` px, so centre `p` between header and sheet.
  const shift = top ? h / 2 - (top + visible / 2) : Math.max(0, h / 2 - visible / 2);
  return { lat: p.lat - (shift * mpp) / 111_320, lng: p.lng, zoom };
}

const NEAR = new Set(['lt200', '200_500', '500_1k', '1_2k']);

/** R-04.16: someone visible within 2 km? */
export function isNear(d: Card['distance']): boolean {
  if (!d) return false;
  if (d.kind === 'exact') return d.m < 2000;
  if (d.kind === 'area') return typeof d.m === 'number' ? d.m < 2000 : NEAR.has(d.bucket);
  return false;
}

// ------------------------------------------------------------------ #113 merged map

export const INTENTS: Mode[] = ['hookup', 'friends', 'sport'];

/** R-04.18: chips → ordered, never empty (the last chip on can't be turned off). */
export function toggleIntent(cur: Mode[], m: Mode): Mode[] {
  const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
  return next.length ? INTENTS.filter((x) => next.includes(x)) : cur;
}

/** Saved chips (AsyncStorage) → valid ordered list, default all three. */
export function restoreIntents(saved: string | null): Mode[] {
  try {
    const v = saved ? (JSON.parse(saved) as unknown) : null;
    const list = Array.isArray(v) ? INTENTS.filter((m) => v.includes(m)) : [];
    return list.length ? list : [...INTENTS];
  } catch {
    return [...INTENTS];
  }
}

export type RingSeg = { color: string; dash: string; offset: number };

/**
 * R-04.19 intent ring: equal segments clockwise from 12 o'clock (caller rotates -90°), in order
 * hookup → friends → sport, `gap` px between segments, none for a single intent.
 */
export function ringSegments(intents: Mode[] | undefined, r: number, gap = 5): RingSeg[] {
  const list = INTENTS.filter((m) => (intents ?? []).includes(m));
  const circ = 2 * Math.PI * r;
  if (list.length === 0) return [];
  if (list.length === 1) return [{ color: modeColor[list[0]], dash: `${circ} 0`, offset: 0 }];
  const n = list.length;
  const len = circ / n - gap;
  return list.map((m, i) => ({ color: modeColor[m], dash: `${len.toFixed(2)} ${(circ - len).toFixed(2)}`, offset: -(i * (circ / n) + gap / 2) }));
}

export type PlaceKind = 'clubs' | 'saunas' | 'parties' | 'gyms';
export const PLACE_KINDS: PlaceKind[] = ['clubs', 'saunas', 'parties', 'gyms'];
export type Layers = { on: Record<PlaceKind, boolean>; gymsTouched: boolean };
/** #223: Clubs and Saunas off by default; Parties on; Gyms by the Sport-only rule. */
export const defaultLayers: Layers = { on: { clubs: false, saunas: false, parties: true, gyms: false }, gymsTouched: false };

export function restoreLayers(saved: string | null): Layers {
  try {
    const v = saved ? (JSON.parse(saved) as Partial<Layers>) : null;
    return { on: { ...defaultLayers.on, ...(v?.on ?? {}) }, gymsTouched: !!v?.gymsTouched };
  } catch {
    return defaultLayers;
  }
}

/** R-04.20: effective layers. Gyms turn on by themselves while Sport is the only chip, until toggled once. */
export function activeKinds(l: Layers, intents: Mode[]): PlaceKind[] {
  const sportOnly = intents.length === 1 && intents[0] === 'sport';
  return PLACE_KINDS.filter((k) => (k === 'gyms' && !l.gymsTouched ? l.on.gyms || sportOnly : l.on[k]));
}

export function toggleLayer(l: Layers, k: PlaceKind, intents: Mode[]): Layers {
  const shown = activeKinds(l, intents).includes(k);
  return { on: { ...l.on, [k]: !shown }, gymsTouched: l.gymsTouched || k === 'gyms' };
}

/** Which kinds a place belongs to (for chip filtering on the client). */
export function placeKind(p: Place): PlaceKind {
  if (p.type !== 'venue') return 'parties';
  if (p.kind === 'gym') return 'gyms';
  if (p.kind === 'sauna') return 'saunas';
  return 'clubs';
}

let last = { key: '', at: 0 };
/** Runs `fn` once per tap on a map marker: on iOS both the marker's tap and its Pressable can fire. */
export function once(key: string, fn: () => void, now: number = Date.now()): boolean {
  if (last.key === key && now - last.at < 600) return false;
  last = { key, at: now };
  fn();
  return true;
}

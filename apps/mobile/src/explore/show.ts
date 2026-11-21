// #247 R-04.22: show only favorites / friends on the map and grid. Filtered on the device:
// the list of favorites / friends never goes to the server (R-07.32, D-17).
import type { MapData } from '../api/types';

export type Show = 'all' | 'fav' | 'friends';
export const SHOWS: Show[] = ['all', 'fav', 'friends'];
export const SHOW_KEY = 'thirstr.exploreShow';
/** Grid keeps paging until at least this many matches or the end of results. */
export const MIN_SHOWN = 12;

export const restoreShow = (v: string | null): Show => (v === 'fav' || v === 'friends' ? v : 'all');

/** null = everyone. */
export function showIds(show: Show, favs: string[], friends: string[]): Set<string> | null {
  if (show === 'all') return null;
  return new Set(show === 'fav' ? favs : friends);
}

export function keep<T extends { id: string }>(list: T[], ids: Set<string> | null): T[] {
  return ids ? list.filter((c) => ids.has(c.id)) : list;
}

/** Area count bubbles are anonymous, so they go away while the filter is on. */
export function filterMap(m: MapData | null, ids: Set<string> | null): MapData | null {
  if (!m || !ids) return m;
  return { cells: [], pins: keep(m.pins, ids), avatars: keep(m.avatars, ids) };
}

/** Favorites / friends not in what the server returned, in list order. No reason is guessed (never "hidden"). */
export function away(ids: Set<string> | null, order: string[], seen: Iterable<string>): string[] {
  if (!ids) return [];
  const s = new Set(seen);
  return order.filter((id) => ids.has(id) && !s.has(id));
}

export const wantMore = (show: Show, shown: number, next: string | null) => show !== 'all' && shown < MIN_SHOWN && !!next;

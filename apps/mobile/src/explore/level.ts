import { cellToParent, latLngToCell } from 'h3-js';
import { api, type Me } from '../api/client';
import { areaBody, areaCell } from '../geo/cells';
import { currentPosition, lastKnown } from './location';

export type Level = 'hidden' | 'city' | 'area' | 'exact';

export async function position() {
  const p = await currentPosition().catch(() => null);
  if (p) return p;
  const lk = lastKnown();
  return lk ? { lat: lk.lat, lng: lk.lng } : null;
}

/**
 * One-tap level change (S-60, #102, #190) for Hidden / City / Area. Returns null when there is
 * no position (City then offers a city search), else the updated Me.
 */
export async function quickLevel(level: Exclude<Level, 'exact'>, hidden?: { until: string | null; return_level: 'city' | 'area' }, precise?: boolean): Promise<Me | null> {
  const p = await position();
  if (!p) return null;
  if (level === 'hidden') return api<Me>('PUT', '/me/location', { level, cell_r9: areaCell(p.lat, p.lng), ...(hidden ?? {}) });
  if (level === 'city') return api<Me>('PUT', '/me/location', { level: 'city', cell_r5: cellToParent(latLngToCell(p.lat, p.lng, 9), 5) });
  // #197 R-05.13: Area sends the r10 cell too when "Show closer distance" is on.
  return api<Me>('PUT', '/me/location', { level, ...areaBody(p.lat, p.lng, precise), ...(precise === undefined ? {} : { precise }) });
}

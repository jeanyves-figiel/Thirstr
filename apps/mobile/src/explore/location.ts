import * as ExpoLocation from 'expo-location';
import { api, Me } from '../api/client';
import { areaBody, areaCell } from '../geo/cells';

// R-05.8: update on significant move (> 100 m) or every 5 min in foreground; rate limit 1/30 s.
// Only the r9 cell leaves the device (R-05.1); Exact pins are set explicitly in the Location sheet.
let last: { lat: number; lng: number; at: number; cell: string } | null = null;

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export type LatLng = { lat: number; lng: number };

// Device position for the viewer's own map only (R-04.13). Never sent: only cells leave the device.
let device: LatLng | null = null;
const listeners = new Set<(p: LatLng) => void>();
function setDevice(p: LatLng) {
  device = p;
  listeners.forEach((l) => l(p));
}
export function devicePosition() {
  return device;
}
export function onDevicePosition(l: (p: LatLng) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Asks for "When in use" once, if never asked (R-04.13). Returns whether granted. */
export async function ensurePermission(): Promise<boolean> {
  const perm = await ExpoLocation.getForegroundPermissionsAsync();
  if (perm.status === 'granted') return true;
  if (perm.status !== 'undetermined' || !perm.canAskAgain) return false;
  return (await ExpoLocation.requestForegroundPermissionsAsync()).status === 'granted';
}

/** Last known fix first (instant), then a fresh one. Updates devicePosition(). */
export async function locateDevice(): Promise<LatLng | null> {
  if (!(await ensurePermission())) return null;
  const quick = await ExpoLocation.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null);
  if (quick && !device) setDevice({ lat: quick.coords.latitude, lng: quick.coords.longitude });
  return currentPosition();
}

export async function currentPosition(): Promise<LatLng | null> {
  const perm = await ExpoLocation.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  setDevice(p);
  return p;
}

/**
 * #191 Add a place (F-12 R-12.11): a fresh high-accuracy fix with its accuracy in metres. This is
 * the only flow that sends exact coordinates, after the member confirmed the exact-location warning.
 */
export async function precisePosition(): Promise<(LatLng & { accuracy: number }) | null> {
  if (!(await ensurePermission())) return null;
  const pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Highest });
  const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  setDevice(p);
  return { ...p, accuracy: Math.round(pos.coords.accuracy ?? 999) };
}

/** Sends the current r9 cell if needed. Returns updated Me, or null when nothing was sent. */
export async function syncLocation(me: Me, force = false): Promise<Me | null> {
  const level = me.location?.level;
  if (level !== 'area' && level !== 'exact' && level !== 'hidden') return null;
  const pos = await currentPosition().catch(() => null);
  if (!pos) return null;
  const now = Date.now();
  if (!force && last && now - last.at < 30_000) return null;
  if (!force && last && metres(last, pos) < 100 && now - last.at < 5 * 60_000) return null;
  const cell = areaCell(pos.lat, pos.lng);
  last = { ...pos, at: now, cell };
  const closer = level === 'area' && !!me.location?.precise;
  const body = level === 'hidden' ? { level: 'hidden', cell_r9: cell } : { level: level === 'exact' ? 'exact' : 'area', ...areaBody(pos.lat, pos.lng, closer) };
  return api<Me>('PUT', '/me/location', body);
}

export function lastKnown() {
  return last;
}

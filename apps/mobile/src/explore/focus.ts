// #210 "Map" on a Tonight party card: Explore centres on the party's approximate area (r8 centroid,
// never the address) and selects its marker. One pending request; Locate me clears it.
import { useEffect, useState } from 'react';

export type MapFocus = { lat: number; lng: number; placeId: string; seq: number };

let cur: MapFocus | null = null;
let seq = 0;
const subs = new Set<(f: MapFocus | null) => void>();

export function focusMap(f: Omit<MapFocus, 'seq'>) {
  cur = { ...f, seq: ++seq };
  subs.forEach((s) => s(cur));
}

export function clearMapFocus() {
  cur = null;
  subs.forEach((s) => s(cur));
}

export function useMapFocus(): MapFocus | null {
  const [f, setF] = useState(cur);
  useEffect(() => {
    subs.add(setF);
    return () => {
      subs.delete(setF);
    };
  }, []);
  return f;
}

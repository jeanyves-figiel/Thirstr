import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { ProfileView, VisitorTrip } from '../api/types';

// F-20 R-20.8: the Visiting label in chat headers and inbox rows. Kept in memory only (never stored):
// filled when his profile or the chat opens; the inbox shows what is already known on this phone.
const cache = new Map<string, { trip: VisitorTrip | null; at: number }>();
const TTL = 10 * 60_000;
const subs = new Set<() => void>();

export function rememberTrip(peer: string, trip: VisitorTrip | null | undefined) {
  cache.set(peer, { trip: trip ?? null, at: Date.now() });
  subs.forEach((f) => f());
}

export const knownTrip = (peer: string): VisitorTrip | null => cache.get(peer)?.trip ?? null;

/** His shown trip to my area, fetched at most every 10 min. */
export function usePeerTrip(peer: string | null | undefined): VisitorTrip | null {
  useEffect(() => {
    if (!peer) return;
    const hit = cache.get(peer);
    if (hit && Date.now() - hit.at < TTL) return;
    api<ProfileView>('GET', `/profiles/${peer}`).then(
      (v) => rememberTrip(peer, v.trip),
      () => {},
    );
  }, [peer]);
  return useSyncExternalStore(subscribe, () => (peer ? knownTrip(peer) : null));
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** Re-render when any known trip changes (inbox rows). */
export function useTripsVersion(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return n;
}

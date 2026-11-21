// F-19 G8 (#187): Explore grid size (2, 3 or 4 per row), per device. Set by pinching the grid or in Filters.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Cols = 2 | 3 | 4;
const KEY = 'thirstr.explore.cols';
// #223: smallest tiles (4 per row) by default.
let cur: Cols = 4;
const subs = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((v) => {
    const n = Number(v);
    if (n === 2 || n === 3 || n === 4) setCols(n, false);
  })
  .catch(() => {});

export function setCols(n: Cols, save = true) {
  if (n === cur) return;
  cur = n;
  subs.forEach((f) => f());
  if (save) AsyncStorage.setItem(KEY, String(n)).catch(() => {});
}

export function useCols(): Cols {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => cur,
  );
}

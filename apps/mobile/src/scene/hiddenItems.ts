// #210 Plans and parties hidden from Tonight (and parties from the map), on this device only.
// Kept in the encrypted store until the item ends, then forgotten. Nothing is sent to the server.
import { useEffect, useState } from 'react';
import { privateStore } from '../app/privateStore';

const KEY = 'thirstr.tonightHidden';
type Map = Record<string, number>; // id → forget after (epoch ms)

let cur: Map = {};
let loaded = false;
const subs = new Set<(m: Map) => void>();

/** Drop entries whose item has ended. Pure, exported for tests. */
export function prune(m: Map, now: number): Map {
  const out: Map = {};
  for (const [k, v] of Object.entries(m)) if (v > now) out[k] = v;
  return out;
}

function emit() {
  subs.forEach((f) => f(cur));
  privateStore.setItem(KEY, JSON.stringify(cur)).catch(() => {});
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const v = await privateStore.getItem(KEY);
    if (v) cur = { ...prune(JSON.parse(v) as Map, Date.now()), ...cur };
  } catch {
    /* empty */
  }
  subs.forEach((f) => f(cur));
}

/** Hide until `until` (the plan's or party's end; at least 1 h). */
export function hideItem(id: string, until: string | number) {
  const t = typeof until === 'number' ? until : Date.parse(until);
  cur = { ...prune(cur, Date.now()), [id]: Math.max(Number.isFinite(t) ? t : 0, Date.now() + 3600e3) };
  emit();
}

export function unhideItem(id: string) {
  const { [id]: _, ...rest } = cur;
  void _;
  cur = rest;
  emit();
}

export function useHiddenItems(): Set<string> {
  const [m, setM] = useState<Map>(cur);
  useEffect(() => {
    subs.add(setM);
    load();
    return () => {
      subs.delete(setM);
    };
  }, []);
  return new Set(Object.keys(m));
}

import { useSyncExternalStore } from 'react';
import { privateStore } from '../app/privateStore';

// F-24 R-24.1 (#346): the person's own last asks, on this phone only (encrypted store), max 20,
// newest first. Up to 3 show as suggestion chips; cleared in Settings › Ask, Fit & Picks (R-24.30).
const KEY = 'thirstr.ask.recent.v1';
const MAX = 20;
let items: string[] = [];
let loaded = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export async function loadRecent(): Promise<string[]> {
  if (loaded) return items;
  try {
    const v = JSON.parse((await privateStore.getItem(KEY)) ?? '[]');
    items = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    items = [];
  }
  loaded = true;
  emit();
  return items;
}

export function addRecent(text: string): Promise<void> {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return Promise.resolve();
  items = [t, ...items.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  loaded = true;
  emit();
  return privateStore.setItem(KEY, JSON.stringify(items)).catch(() => {});
}

export async function clearRecent(): Promise<void> {
  items = [];
  emit();
  await privateStore.removeItem(KEY).catch(() => {});
}

export function useRecent(): string[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (!loaded) loadRecent();
      return () => subs.delete(f);
    },
    () => items,
  );
}

export const _resetRecent = () => {
  items = [];
  loaded = false;
};

import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MyProfile } from '../api/types';
import { privateStore as AsyncStorage } from '../app/privateStore';
import { getLocal } from '../me/localFields';
import type { Fields } from './fit';

// F-24 (#338): what Fit and Picks need on this phone. My own fields (server values + values kept
// on the phone, R-06.4) and the Ask, Fit & Picks switches (R-24.30). Nothing here is sent anywhere.

export type AiPrefs = { ask: boolean; fit: boolean; picks: boolean; learn: boolean };
export const AI_DEFAULTS: AiPrefs = { ask: true, fit: true, picks: true, learn: true };
const PREFS_KEY = 'thirstr.ai.prefs.v1';

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

let prefs: AiPrefs = AI_DEFAULTS;
let prefsLoaded: Promise<void> | null = null;

export function loadPrefs(): Promise<void> {
  prefsLoaded ??= AsyncStorage.getItem(PREFS_KEY)
    .then((s) => {
      if (s) prefs = { ...AI_DEFAULTS, ...(JSON.parse(s) as Partial<AiPrefs>) };
      emit();
    })
    .catch(() => {});
  return prefsLoaded;
}

export const getPrefs = () => prefs;

export async function setPrefs(p: Partial<AiPrefs>): Promise<void> {
  prefs = { ...prefs, ...p };
  emit();
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
}

let self: Fields | null = null;
let selfLoading: Promise<Fields | null> | null = null;

/** My fields for Fit: GET /me/profiles once per session, refreshed by `setSelf` after an edit. */
export function loadSelf(): Promise<Fields | null> {
  if (self) return Promise.resolve(self);
  selfLoading ??= api<{ profiles: MyProfile[] }>('GET', '/me/profiles')
    .then(async (r) => {
      const p = r.profiles[0];
      if (!p) return null;
      self = { ...(p.fields ?? {}), ...(await getLocal(p.id)) };
      emit();
      return self;
    })
    .catch(() => {
      selfLoading = null;
      return null;
    });
  return selfLoading;
}

/** Called by the profile editor after each save (server + local values). */
export function setSelf(fields: Fields) {
  self = { ...fields };
  emit();
}

export const getSelf = () => self;

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React: my fields + switches, re-rendered when either changes. */
export function useMatchState(): { self: Fields | null; prefs: AiPrefs } {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = subscribe(() => tick((n) => n + 1));
    loadPrefs();
    loadSelf();
    return () => {
      off();
    };
  }, []);
  return { self, prefs };
}

/** Test hook. */
export function _reset() {
  self = null;
  selfLoading = null;
  prefs = AI_DEFAULTS;
  prefsLoaded = null;
}

// EN-13 (#172) server-driven flags / kill switches, EN-14 (#173) minimum build + forced update.
// GET /v1/config needs no account. Last answer kept on the phone (public, not personal: plain
// storage) so a kill switch still applies offline; flags default to on when nothing is known yet.
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/v1';

export type AppConfig = {
  min_build: { ios: number; android: number };
  upgrade_required: boolean;
  store_url: { ios: string; android: string };
  flags: Record<string, boolean>;
};

const KEY = 'thirstr.appConfig';
let cfg: AppConfig | null = null;
let forced = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Native build number (CFBundleVersion / versionCode); null on web or in dev. */
export function buildNumber(): number | null {
  const b = Number.parseInt(Application.nativeBuildVersion ?? '', 10);
  return Number.isFinite(b) && b >= 0 ? b : null;
}

/** Headers every API call sends (EN-14): lets the server answer 426 to builds below the minimum. */
export function clientHeaders(): Record<string, string> {
  const b = buildNumber();
  return b === null ? {} : { 'x-thirstr-build': String(b) };
}

export const flag = (name: string) => cfg?.flags[name] ?? true;
export const upgradeRequired = () => forced || !!cfg?.upgrade_required;
export const storeUrl = () => (Platform.OS === 'android' ? cfg?.store_url.android : cfg?.store_url.ios) ?? null;

/** Called by the API client on HTTP 426. */
export function markUpgradeRequired() {
  if (forced) return;
  forced = true;
  emit();
}

function tooOld(c: AppConfig) {
  const b = buildNumber();
  if (b === null || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return false;
  return b < (c.min_build[Platform.OS] ?? 0);
}

export async function loadCached() {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (s && !cfg) {
      cfg = JSON.parse(s) as AppConfig;
      if (tooOld(cfg)) forced = true;
      emit();
    }
  } catch {
    // no cache yet
  }
}

/** Fetches the config (start + every foreground). Network errors keep the last known config. */
export async function refreshConfig(fetcher: typeof fetch = fetch) {
  try {
    const headers: Record<string, string> = { 'x-thirstr-platform': Platform.OS, ...clientHeaders() };
    const r = await fetcher(`${API_BASE}/config`, { headers });
    if (!r.ok) return;
    const c = (await r.json()) as AppConfig;
    cfg = c;
    if (c.upgrade_required || tooOld(c)) forced = true;
    emit();
    await AsyncStorage.setItem(KEY, JSON.stringify(c)).catch(() => {});
  } catch {
    // offline: keep what we have
  }
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}

let version = 0;
subs.add(() => version++);
const snap = () => version;

/** Re-renders when flags or the upgrade state change. */
export function useAppConfig() {
  useSyncExternalStore(subscribe, snap, snap);
  return { flag, upgradeRequired: upgradeRequired(), storeUrl: storeUrl() };
}

/** Test hook. */
export function _reset() {
  cfg = null;
  forced = false;
  emit();
}

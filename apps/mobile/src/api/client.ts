import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { clientHeaders, markUpgradeRequired } from '../app/config';
import type { MyProfile, NowStatus, Settings } from './types';

// Web build is served by the API host (DEV: https://localhost:7443), so same-origin by default.
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/v1';

const K = { access: 'thirstr.access', refresh: 'thirstr.refresh', install: 'thirstr.install', device: 'thirstr.device', deviceSecret: 'thirstr.device.secret' };

// Tokens live in Keychain/Keystore on native; web (DEV tool only) falls back to AsyncStorage.
const native = Platform.OS === 'ios' || Platform.OS === 'android';
const secure = {
  get: (k: string) => (native ? SecureStore.getItemAsync(k) : AsyncStorage.getItem(k)),
  set: (k: string, v: string) => (native ? SecureStore.setItemAsync(k, v) : AsyncStorage.setItem(k, v)),
  del: (k: string) => (native ? SecureStore.deleteItemAsync(k) : AsyncStorage.removeItem(k)),
};

export type Me = {
  status: 'active' | 'paused' | 'quarantined' | 'suspended' | 'banned' | 'deleted';
  verified: boolean;
  verified_since?: string | null;
  onboarding_step: 'basics' | 'location' | 'photo' | 'verify' | 'done';
  safe_mode: 'auto' | 'on' | 'off' | string;
  safe_mode_active?: boolean;
  /** #114 R-05.7: end of Hidden (null = until I switch) and the level to come back as. */
  hidden_until?: string | null;
  hidden_return?: 'city' | 'area' | null;
  hidden?: boolean;
  member_since?: string;
  has_email?: boolean;
  created_at?: string;
  profile: null | MyProfile;
  profiles?: MyProfile[];
  location: null | {
    level: 'hidden' | 'city' | 'area' | 'exact' | null;
    pin?: null | { lat: number; lng: number; audience: string; expires_at: string };
    hide_from_hidden?: boolean;
    /** #197 R-05.13 "Show closer distance" choice (applies on Area). */
    precise?: boolean;
    /** Own coarse cell, only for centring the own map (R-04.13). */
    cell_r5?: string | null;
  };
  now?: NowStatus | null;
  settings?: Settings;
};

export type Photo = { id: string; slot: number; status: string; reject_reason: string | null; url: string | null; thumb_url?: string | null; main_ok?: boolean };
/** device_id / device_secret come with a sign-in (SR-04): kept to resume this device later. */
export type Session = { access_token: string; refresh_token: string; expires_in: number; account: Me; device_id?: string; device_secret?: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string[]>,
    /** Extra error body keys, e.g. `existing` on 409 place_exists (R-12.11). */
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function installId(): Promise<string> {
  let id = await AsyncStorage.getItem(K.install);
  if (!id) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await AsyncStorage.setItem(K.install, id);
  }
  return id;
}

export async function saveSession(s: Session) {
  await secure.set(K.access, s.access_token);
  await secure.set(K.refresh, s.refresh_token);
  if (s.device_id && s.device_secret) {
    await secure.set(K.device, s.device_id);
    await secure.set(K.deviceSecret, s.device_secret);
  }
  return s.account;
}

/** SR-04 (#144): sign-ins name this install's previous device so the server can resume it
 * (keeping the chat messages queued for it) instead of registering a new one. */
async function resumeHeaders(path: string): Promise<Record<string, string>> {
  if (!path.startsWith('/auth/') || path === '/auth/refresh') return {};
  const [id, secret] = await Promise.all([secure.get(K.device), secure.get(K.deviceSecret)]);
  return id && secret ? { 'x-thirstr-device': id, 'x-thirstr-device-secret': secret } : {};
}

export async function clearSession() {
  await secure.del(K.access);
  await secure.del(K.refresh);
}

export async function hasSession() {
  return (await secure.get(K.refresh)) !== null;
}

// #116: one refresh at a time. Refresh tokens rotate on use and the server revokes the device
// when a spent token comes back, so parallel 401s must share a single /auth/refresh call.
let refreshing: Promise<boolean> | null = null;

export function refresh(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(): Promise<boolean> {
  const token = await secure.get(K.refresh);
  if (!token) return false;
  let res: Response;
  try {
    res = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh: token }),
    });
  } catch {
    return false; // offline: keep the session, retry later
  }
  if (res.ok) {
    await saveSession(await res.json());
    return true;
  }
  // Another refresh (other JS context) already rotated it: use the new tokens.
  if ((await secure.get(K.refresh)) !== token) return true;
  // Only a definitive answer ends the session; 409 race, 429, 5xx keep it.
  if (res.status === 401 || res.status === 403) await clearSession();
  return false;
}

/** Thrown when a request gets no answer in time: the result is unknown (R-07.19). */
export class TimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true, timeoutMs?: number): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-thirstr-install': await installId(),
    'x-thirstr-platform': Platform.OS,
    ...clientHeaders(),
  };
  const access = await secure.get(K.access);
  if (access) headers.authorization = 'Bearer ' + access;
  Object.assign(headers, await resumeHeaders(path));

  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl?.signal });
  } catch (e) {
    if (ctl?.signal.aborted) throw new TimeoutError();
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  // #116: a parallel call may already have refreshed; only refresh if our token is still the stored one.
  if (res.status === 401 && retry && access && ((await secure.get(K.access)) !== access || (await refresh()))) return api<T>(method, path, body, false, timeoutMs);
  if (res.status === 426) markUpgradeRequired(); // EN-14: build below the minimum
  if (res.status === 204) return undefined as T;
  if (res.status === 202) return (await res.json().catch(() => undefined)) as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json.error ?? {};
    const { code, message, fields, ...extra } = e;
    throw new ApiError(res.status, code ?? 'internal', message ?? 'Something went wrong', fields, extra);
  }
  return json as T;
}

export const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

export const API_BASE = BASE;

/** Uploads a picked image to a presigned URL (public photos; EXIF stripped by the picker re-encode). */
export async function putBlob(url: string, uri: string, contentType: string) {
  const blob = await (await fetch(uri)).blob();
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: blob });
  if (!res.ok) throw new ApiError(res.status, 'upload_failed', 'Upload failed');
}

/** Current access token (realtime socket auth). Call any `api()` first to refresh an expired one. */
export const accessToken = () => secure.get(K.access);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, type Me, type PlusLimits } from '../api/client';

// F-23 Thirstr Plus (#7, #318): helpers shared by the Plus screen and the limit cards.
// The server is the source of every number (`/me.limits`); these fallbacks only cover an older
// server that does not send them yet (= Plus values, the closed-beta behaviour).

export const PLUS_FALLBACK: PlusLimits = {
  nearby: null,
  distance_km: 100,
  party_per_week: null,
  party_capacity: 40,
  party_cohosts: 3,
  party_recurring: true,
  trips: 5,
  look_around_any_city: true,
  tonight_active: 3,
  moments_per_day: 20,
  moments_live: 10,
  moments_48h: true,
  album_bytes: 25_000_000_000,
  video_seconds: 600,
  translate: true,
  friend_alerts: 100,
  filter_presets: 10,
  chat_folders: 10,
  extras: true,
  views_list: true,
};

export const limits = (me: Pick<Me, 'limits'>): PlusLimits => me.limits ?? PLUS_FALLBACK;
export const isPlus = (me: Pick<Me, 'plus'>): boolean => me.plus?.active ?? true;

/** R-23.7: no Plus prompt in the first 3 days after sign-up. */
export function promptsAllowed(me: Pick<Me, 'plus' | 'created_at'>, now = Date.now()): boolean {
  if (isPlus(me)) return false;
  const at = me.created_at ? Date.parse(me.created_at) : NaN;
  return Number.isFinite(at) ? now - at >= 3 * 86_400_000 : true;
}

export type PlusLimitHit = { limit: keyof PlusLimits | string; free: number | null; plus: number | null; next_at: string | null; message: string };

/** 422 `plus_limit` from the server (R-23.16), else null. */
export function plusLimitOf(e: unknown): PlusLimitHit | null {
  if (!(e instanceof ApiError) || e.code !== 'plus_limit') return null;
  const x = (e.extra ?? {}) as Record<string, unknown>;
  return {
    limit: String(x.limit ?? 'generic'),
    free: typeof x.free === 'number' ? x.free : null,
    plus: typeof x.plus === 'number' ? x.plus : null,
    next_at: typeof x.next_at === 'string' ? x.next_at : null,
    message: e.message,
  };
}

// ✕ on a limit card hides that card on this device for 7 days (R-23.16).
const HIDE = 'thirstr.plus.hide.';
const WEEK = 7 * 86_400_000;

export async function cardHidden(key: string, now = Date.now()): Promise<boolean> {
  try {
    const v = Number(await AsyncStorage.getItem(HIDE + key));
    return Number.isFinite(v) && v > 0 && now - v < WEEK;
  } catch {
    return false;
  }
}

export async function hideCard(key: string, now = Date.now()): Promise<void> {
  await AsyncStorage.setItem(HIDE + key, String(now)).catch(() => {});
}

/** Store pages where people cancel (R-23.13): the store's own subscription screen. */
export const manageUrl = (os: string) => (os === 'android' ? 'https://play.google.com/store/account/subscriptions?package=app.thirstr' : 'itms-apps://apps.apple.com/account/subscriptions');

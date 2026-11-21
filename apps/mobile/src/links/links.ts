// I-01 (#17) shared posts: URL rules, platforms, per-sender link hash, daily limit. Everything here
// runs on the phone; the server never sees a shared URL (R-I01.31).
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromB64, hex, rand, toB64, utf8 } from '../chat/bytes';
import { kv } from '../chat/kv';
import { flag } from '../app/config';
import { color } from '../theme/tokens';

export type Platform = 'x' | 'bluesky' | 'onlyfans' | 'jff' | 'instagram' | 'web';

const HOSTS: Record<string, Platform> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'mobile.twitter.com': 'x',
  'bsky.app': 'bluesky',
  'onlyfans.com': 'onlyfans',
  'justfor.fans': 'jff',
  'instagram.com': 'instagram',
};

export const PLATFORM_NAME: Record<Platform, string> = {
  x: 'X',
  bluesky: 'Bluesky',
  onlyfans: 'OnlyFans',
  jff: 'JustFor.Fans',
  instagram: 'Instagram',
  web: '',
};

/** Glyph text + colours for the platform tile (Pop: brand colour fill, white or ink text). */
export const GLYPH: Record<Platform, { t: string; bg: string; fg: string }> = {
  x: { t: '𝕏', bg: color.brandX, fg: color.onAccent },
  bluesky: { t: 'BS', bg: color.brandBluesky, fg: color.fgPrimary },
  onlyfans: { t: 'OF', bg: color.brandOnlyFans, fg: color.onAccent },
  jff: { t: 'JFF', bg: color.brandJff, fg: color.fgPrimary },
  instagram: { t: 'IG', bg: color.brandInstagram, fg: color.fgPrimary },
  web: { t: '◎', bg: color.bgOverlay, fg: color.fgPrimary },
};

export const ADULT: Platform[] = ['onlyfans', 'jff'];
export const isAdult = (p: Platform) => ADULT.includes(p);

/** R-I01.30: the build under store review (and Safe Mode, R-I01.28) gets no adult-platform previews. */
export const adultAllowed = (safeMode: boolean) => !safeMode && flag('adult_links');

// R-I01.6 / R-I01.7: tracking parameters removed before sending.
const TRACKERS = /^(utm_[a-z]+|fbclid|gclid|igshid|mc_[a-z]+|si|s|t|ref_src|ref_url)$/i;

export function registrable(host: string) {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  return parts.slice(-2).join('.');
}

export function platformOf(url: string): Platform {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return HOSTS[h] ?? HOSTS[registrable(h)] ?? 'web';
  } catch {
    return 'web';
  }
}

const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|\d+\.\d+\.\d+\.\d+|\[.*\])$/i;

/** R-I01.1: first https URL in the text (http upgraded); null when none or not allowed (R-I01.5). */
export function firstUrl(text: string): string | null {
  const m = text.match(/\bhttps?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  return cleanUrl(m[0].replace(/[).,!?;:]+$/, ''));
}

export function cleanUrl(raw: string): string | null {
  try {
    const u = new URL(raw.replace(/^http:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || !u.hostname || BLOCKED_HOST.test(u.hostname) || u.username || u.password) return null;
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKERS.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString().replace(/\?$/, '');
  } catch {
    return null;
  }
}

/** Host shown to people: decoded, without www. `mixed` = several scripts in the host (R-I01.10). */
export function displayHost(url: string): { host: string; mixed: boolean } {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const latin = /[a-z]/i.test(host);
    const other = /[^\x00-\x7F]/.test(host) || /xn--/.test(host);
    return { host, mixed: latin && other };
  } catch {
    return { host: url, mixed: false };
  }
}

// R-I01.23: per-sender link hash. The key never leaves this phone, so the server can only see that
// one sender sent the same link to many people, never which link, and can't compare senders.
let lhKey: Uint8Array | null = null;
export async function linkHash(url: string): Promise<string> {
  if (!lhKey) {
    const k = await kv.get<string>('links.lhkey');
    if (k) lhKey = fromB64(k);
    else {
      lhKey = rand(32);
      await kv.set('links.lhkey', toB64(lhKey));
    }
  }
  return hex(hmac(sha256, lhKey, utf8(url))).slice(0, 16);
}

// R-I01.23: ≤ 40 link cards a day per phone, ≤ 5 chats per share.
export const MAX_CHATS = 5;
export const DAILY = 40;
const day = () => new Date().toISOString().slice(0, 10);

export async function dailyLeft(): Promise<number> {
  const c = await kv.get<{ d: string; n: number }>('links.daily');
  return DAILY - (c?.d === day() ? c.n : 0);
}

export async function countSends(n: number) {
  const c = await kv.get<{ d: string; n: number }>('links.daily');
  const cur = c?.d === day() ? c.n : 0;
  await kv.set('links.daily', { d: day(), n: cur + n });
}

/** Adult-platform recipients today (R-I01.23): over 15 shows the Creator note again. */
export async function countAdult(n: number): Promise<boolean> {
  const c = await kv.get<{ d: string; n: number }>('links.adult');
  const cur = (c?.d === day() ? c.n : 0) + n;
  await kv.set('links.adult', { d: day(), n: cur });
  return cur >= 15 && cur - n < 15;
}

/** R-I01.10: hosts the person said not to ask about again (X and Bluesky only). */
export async function trusted(host: string) {
  return ((await kv.get<string[]>('links.trusted')) ?? []).includes(host);
}
export async function trust(host: string) {
  const list = (await kv.get<string[]>('links.trusted')) ?? [];
  if (!list.includes(host)) await kv.set('links.trusted', [...list, host]);
}

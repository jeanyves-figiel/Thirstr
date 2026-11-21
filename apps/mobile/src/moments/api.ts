// F-21 Moments (#212): API calls, upload, batched views (R-21.28). Spec: docs/spec/features/F21-moments.md.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, putBlob } from '../api/client';
import type { Mode } from '../api/types';
import { makeThumb } from '../api/photoUpload';

export type Audience = 'everyone' | 'chats' | 'favorites' | 'friends';
export type CaptionStyle = 'clean' | 'pill' | 'pop';
export type Ttl = 3600 | 21600 | 86400;
export const TTLS: Ttl[] = [3600, 21600, 86400];

/** Rings ride on Explore cards and profiles (R-21.27). */
export type MomentsBadge = { live: number; unseen: boolean; thumb?: string | null } | null;

export type Moment = {
  id: string;
  url: string;
  thumb_url: string | null;
  caption: string | null;
  caption_style: CaptionStyle;
  created_at: string;
  expires_at: string;
  spicy?: boolean;
  seen?: boolean;
};

export type Viewer = { profile_id: string; display_name: string; age: number; at: string; tapped: boolean; screenshot: boolean; photo: string | null };

export type MyMoment = Moment & {
  audience: Audience;
  audience_count: number;
  intents: Mode[];
  status: 'live' | 'review';
  main_ok: boolean;
  seen_count: number;
  tap_count: number;
  quiet_count: number;
  screenshots: number;
  viewers: Viewer[];
};

export type PublishResult = Partial<Omit<MyMoment, 'status'>> & { id: string; status: 'live' | 'review' | 'rejected'; reject_reason?: string | null };

export const forProfile = (profileId: string, mode: Mode) => api<{ moments: Moment[] }>('GET', `/profiles/${profileId}/moments?mode=${mode}`).then((r) => r.moments);
export const mine = () => api<{ moments: MyMoment[] }>('GET', '/moments/mine').then((r) => r.moments);
export const remove = (id: string) => api('DELETE', `/moments/${id}`);
export const tap = (id: string) => api<{ mutual: boolean }>('POST', `/moments/${id}/tap`);
export const screenshot = (id: string) => api('POST', `/moments/${id}/screenshot`).catch(() => undefined);
export const mute = (profileId: string, on: boolean) => api(on ? 'PUT' : 'DELETE', `/moments/mutes/${profileId}`);

const RATIO = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1 } as const;
export type Crop = keyof typeof RATIO;

/**
 * R-21.4: centre crop to the ratio, max 1440 × 2560, JPEG 0.85. Re-encoding drops EXIF / GPS
 * (the manipulator writes a fresh file with no metadata).
 */
export async function prepare(uri: string, w: number, h: number, crop: Crop): Promise<{ uri: string; w: number; h: number }> {
  const r = RATIO[crop];
  let cw = w;
  let ch = Math.round(w / r);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * r);
  }
  const ctx = ImageManipulator.manipulate(uri);
  ctx.crop({ originX: Math.round((w - cw) / 2), originY: Math.round((h - ch) / 2), width: cw, height: ch });
  const scale = Math.min(1, 1440 / cw, 2560 / ch);
  if (scale < 1) ctx.resize({ width: Math.round(cw * scale) });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { uri: out.uri, w: out.width, h: out.height };
}

export type ShareOpts = { audience: Audience; audience_ids: string[]; ttl_s: Ttl; intents: Mode[]; caption: string; caption_style: CaptionStyle };

/** Upload photo + 480 px copy (SR-10), then publish (classifier runs server-side, R-21.24). */
export async function share(uri: string, o: ShareOpts): Promise<PublishResult> {
  const up = await api<{ moment_id: string; put_url: string; thumb_put_url: string }>('POST', '/moments/uploads', { content_type: 'image/jpeg' });
  const thumb = makeThumb(uri)
    .then((t) => putBlob(up.thumb_put_url, t, 'image/jpeg'))
    .catch(() => undefined);
  await Promise.all([putBlob(up.put_url, uri, 'image/jpeg'), thumb]);
  return api<PublishResult>('POST', `/moments/${up.moment_id}/publish`, {
    ...o,
    audience_ids: o.audience === 'everyone' ? [] : o.audience_ids,
    caption: o.caption.trim() || null,
  });
}

// ------------------------------------------------------------------ seen (R-21.28)

const seen = new Set<string>();
let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

export const isSeen = (id: string) => seen.has(id);
export function onSeen(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Marks a Moment seen on this phone at once; the server learns in batches (max every 10 s). */
export function markSeen(id: string, profileId?: string) {
  if (seen.has(id)) return;
  seen.add(id);
  if (profileId) seenPeople.add(profileId);
  pending.push(id);
  subs.forEach((f) => f());
  timer ??= setTimeout(flush, 10_000);
}

/** Profiles whose Moments were all watched in this session (rings turn grey before the next refresh). */
const seenPeople = new Set<string>();
export const watchedAll = (profileId: string) => seenPeople.has(profileId);

export async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  const ids = pending;
  pending = [];
  if (!ids.length) return;
  await api('POST', '/moments/views', { ids }).catch(() => {
    pending = [...ids, ...pending];
  });
}

/** Viewer closed: send now. */
export const flushSoon = () => {
  flush().catch(() => undefined);
};

export function minutesFrom(iso: string, now = Date.now()) {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}
export function minutesLeft(iso: string, now = Date.now()) {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
}

/** R-21.22: expired Moments vanish on the phone too, no network needed. */
export const alive = <T extends { expires_at: string }>(list: T[], now = Date.now()) => list.filter((m) => new Date(m.expires_at).getTime() > now);

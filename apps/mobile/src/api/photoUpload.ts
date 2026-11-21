// Public photo upload (R-06.3, R-08.1) + card-size copy (SR-10, #150).
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, putBlob } from './client';

type Upload = { photo_id: string; put_url: string; thumb_put_url?: string; content_type: string };

export const THUMB_W = 480;

/** 480 px wide JPEG for grid cards and lists (~30–60 KB instead of the 1–2 MB original). */
export async function makeThumb(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: THUMB_W });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
  return out.uri;
}

/** Uploads a picked photo and its thumbnail; returns the photo id to `check`. A failed thumbnail never blocks the photo. */
export async function uploadPublicPhoto(profileId: string, slot: number, uri: string, contentType: string): Promise<string> {
  const up = await api<Upload>('POST', `/me/profiles/${profileId}/photos`, { slot, content_type: contentType });
  const thumb = up.thumb_put_url
    ? makeThumb(uri)
        .then((t) => putBlob(up.thumb_put_url!, t, 'image/jpeg'))
        .catch(() => undefined)
    : Promise.resolve();
  await Promise.all([putBlob(up.put_url, uri, contentType), thumb]);
  return up.photo_id;
}

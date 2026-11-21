// I-02 R-I02.2 (#8): the public page's photo is made here, on the owner's phone: the approved main
// photo scaled to 16 × 20 px JPEG (~600 B). The page only ever gets this, never the photo or a link to it.
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from '../../api/client';

export const PREVIEW_W = 16;
export const PREVIEW_H = 20;

type MainPhoto = { id: string; status: string; url?: string | null; thumb_url?: string | null };

/** The approved main photo, or null (pending / rejected / none). */
export function approvedMain(photos: MainPhoto[] | undefined): MainPhoto | null {
  return photos?.find((p) => p.status === 'ok_main' && (p.thumb_url || p.url)) ?? null;
}

export async function makePreview(uri: string): Promise<string> {
  const dest = new File(Paths.cache, `share-src-${Date.now()}.jpg`);
  const local = uri.startsWith('http') ? (await File.downloadFileAsync(uri, dest)).uri : uri;
  try {
    const ctx = ImageManipulator.manipulate(local);
    ctx.resize({ width: PREVIEW_W, height: PREVIEW_H });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });
    if (!out.base64) throw new Error('no base64');
    return out.base64;
  } finally {
    if (dest.exists) dest.delete();
  }
}

/** Sends a fresh preview for the share link. Silent on failure: the page then shows the name only. */
export async function syncPreview(profileId: string, main: MainPhoto | null): Promise<boolean> {
  if (!main) return false;
  try {
    const jpeg_b64 = await makePreview((main.thumb_url ?? main.url)!);
    await api('PUT', `/me/profiles/${profileId}/share/preview`, { photo_id: main.id, jpeg_b64 });
    return true;
  } catch {
    return false;
  }
}

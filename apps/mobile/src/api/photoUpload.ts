// Public photo pick + upload (R-06.3, R-08.1) + card-size copy (SR-10, #150). Fast path #305.
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FS from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { api, ApiError, putBlob } from './client';

type Upload = { photo_id: string; put_url: string; thumb_put_url?: string; content_type: string };

export const THUMB_W = 480;
/** R-08.1: long edge on the wire. */
export const MAX_PX = 2048;
export const JPEG_Q = 0.82;

/**
 * #305: system photo picker, fast path. No `allowsEditing`: on iOS that forces the old in-app
 * UIImagePickerController (loads the whole library, ~3 s to open, square crop only); without it
 * the out-of-process PHPicker opens at once. `quality: 1` + `current` hands over the original file
 * with no re-encode or HEIC→JPEG transcode; `preparePublicPhoto` does the only encode.
 * Returns null when cancelled.
 */
export async function pickPublicPhoto(): Promise<{ uri: string; width?: number; height?: number } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsEditing: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Current,
  });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { uri: a.uri, width: a.width, height: a.height };
}

/**
 * One on-device pass (R-08.1): decode downsampled to ≤ 2048 px (never the full 12–48 MP in memory),
 * JPEG 0.82, no EXIF/GPS (re-encoding drops all metadata). The 480 px card copy is cut from the
 * same decoded image. Typical: 4–6 MB original → 300–500 KB + 40 KB.
 */
export async function preparePublicPhoto(uri: string): Promise<{ uri: string; thumb: string | null }> {
  const img = await ImageManipulator.manipulate(uri, { maxWidth: MAX_PX, maxHeight: MAX_PX }).renderAsync();
  const full = await img.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_Q });
  let thumb: string | null = null;
  try {
    const ctx = ImageManipulator.manipulate(img);
    ctx.resize({ width: THUMB_W });
    thumb = (await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.72 })).uri;
  } catch {
    // A failed thumbnail never blocks the photo (SR-10).
  }
  return { uri: full.uri, thumb };
}

/** 480 px wide JPEG for grid cards and lists (~30–60 KB instead of the 1–2 MB original). */
export async function makeThumb(uri: string): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  ctx.resize({ width: THUMB_W });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
  return out.uri;
}

/** #305: native streaming PUT from the file (no JS Blob copy); web falls back to fetch. */
export async function putFile(url: string, uri: string, contentType: string): Promise<void> {
  if (Platform.OS === 'web') return putBlob(url, uri, contentType);
  const res = await FS.uploadAsync(url, uri, { httpMethod: 'PUT', uploadType: FS.FileSystemUploadType.BINARY_CONTENT, headers: { 'content-type': contentType } });
  if (res.status < 200 || res.status >= 300) throw new ApiError(res.status, 'upload_failed', 'Upload failed');
}

/**
 * Re-encodes and uploads a picked photo and its thumbnail; returns the photo id to `check`.
 * The upload slot is reserved while the phone encodes (network and CPU overlap).
 */
export async function uploadPublicPhoto(profileId: string, slot: number, uri: string): Promise<string> {
  const reserve = api<Upload>('POST', `/me/profiles/${profileId}/photos`, { slot, content_type: 'image/jpeg' });
  reserve.catch(() => undefined); // handled below; avoids an unhandled rejection while encoding
  const [up, out] = await Promise.all([reserve, preparePublicPhoto(uri)]);
  const thumb = up.thumb_put_url && out.thumb ? putFile(up.thumb_put_url, out.thumb, 'image/jpeg').catch(() => undefined) : Promise.resolve();
  await Promise.all([putFile(up.put_url, out.uri, 'image/jpeg'), thumb]);
  return up.photo_id;
}

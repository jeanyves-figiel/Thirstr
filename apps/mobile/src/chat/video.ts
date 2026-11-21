// F-08 R-08.17 (#138) videos in chats and private albums.
// Send: the system picker exports at 1080p (iOS H.265); the phone then removes every metadata box
// (location, device, dates; mp4.ts) and refuses files over 50 MB or 3 min. Play: the ciphertext is
// decrypted into one temp file in the app cache, played, and deleted when the viewer closes.
import { gcm } from '@noble/ciphers/aes.js';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { fromB64, hex, rand } from './bytes';
import * as MediaCache from './mediaCache';
import { scrubVideo } from './mp4';

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_S = 180;
const WEB = Platform.OS === 'web';

export class VideoError extends Error {
  constructor(public kind: 'large' | 'long' | 'format') {
    super(kind);
  }
}

export const isVideo = (x: { mime: string }) => x.mime.startsWith('video/');

/** Checks size/length and strips metadata in place (AC-08.7). `dur` from the picker when known (s). */
export function prepare(bytes: Uint8Array, dur?: number) {
  if (bytes.length > MAX_BYTES) throw new VideoError('large');
  let info;
  try {
    info = scrubVideo(bytes);
  } catch {
    throw new VideoError('format');
  }
  const d = info.duration ?? dur;
  if (d != null && d > MAX_S + 1) throw new VideoError('long');
  // ftyp brand "qt  " = QuickTime (iPhone .mov); anything else plays as mp4.
  const qt = bytes[8] === 0x71 && bytes[9] === 0x74;
  return { bytes, dur: d != null ? Math.round(d) : undefined, mime: qt ? 'video/quicktime' : 'video/mp4' };
}

async function cipher(ref: { blob: string; once?: boolean; exp?: number }) {
  let ct = await MediaCache.get(ref.blob).catch(() => null);
  if (!ct) {
    const { url } = await api<{ url: string }>('GET', `/media/${ref.blob}`);
    ct = new Uint8Array(await (await fetch(url)).arrayBuffer());
    // View-once videos are never kept on the phone, even as ciphertext.
    if (!ref.once) await MediaCache.put(ref.blob, ct, { exp: ref.exp }).catch(() => {});
  }
  return ct;
}

let swept = false;
async function dir() {
  const d = new Directory(Paths.cache, 'vplay');
  // First video of this launch: delete anything a crash may have left behind.
  if (!swept) {
    swept = true;
    try {
      if (d.exists) d.delete();
    } catch {
      // ignore
    }
  }
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export type Temp = { uri: string; done: () => void };

/** Decrypts a video into one temp file (web: blob URL). Call `done()` when the viewer closes. */
export async function openTemp(ref: { blob: string; key: string; iv: string; mime: string; once?: boolean; exp?: number }): Promise<Temp> {
  const plain = gcm(fromB64(ref.key), fromB64(ref.iv)).decrypt(await cipher(ref));
  if (WEB) {
    const uri = URL.createObjectURL(new Blob([plain as unknown as BlobPart], { type: ref.mime }));
    return { uri, done: () => URL.revokeObjectURL(uri) };
  }
  const f = new File(await dir(), `${hex(rand(8))}${ref.mime === 'video/quicktime' ? '.mov' : '.mp4'}`);
  f.create();
  f.write(plain);
  return {
    uri: f.uri,
    done: () => {
      try {
        if (f.exists) f.delete();
      } catch {
        // already gone
      }
    },
  };
}

/** Deletes every leftover temp video (app start, sign-out, wipe). */
export async function clearTemp() {
  if (WEB) return;
  try {
    const d = new Directory(Paths.cache, 'vplay');
    if (d.exists) d.delete();
  } catch {
    // nothing to delete
  }
}

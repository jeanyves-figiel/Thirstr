// F-08 R-08.17 (#138): removes location and device metadata from MP4 / QuickTime video files on the phone.
// Phones write the place a video was shot (QuickTime `©xyz`, `com.apple.quicktime.location.ISO6709`
// in `meta`/`keys`, Android `udta/©xyz`, XMP `uuid` boxes), the device make/model and the time.
// Every metadata box (`udta`, `meta`, `uuid`, `XMP_`) at file, movie and track level is overwritten in
// place by a `free` box of the same size filled with zeros, so no offset in the file moves (the sample
// tables stay valid without rewriting them). Creation/modification times in `mvhd`/`tkhd`/`mdhd` are zeroed.

const META = new Set(['udta', 'meta', 'uuid', 'XMP_']);
/** Containers we walk into to find metadata (movie → track → media → media info). */
const WALK = new Set(['moov', 'trak', 'mdia', 'minf', 'edts']);
const TIMES = new Set(['mvhd', 'tkhd', 'mdhd']);

export type VideoInfo = { duration?: number; removed: string[] };

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const name = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Box at `o`: header length and total size (handles 64-bit and "to the end" sizes). */
function box(b: Uint8Array, o: number, end: number) {
  if (o + 8 > end) return null;
  let size = u32(b, o);
  let head = 8;
  if (size === 1) {
    if (o + 16 > end) return null;
    const hi = u32(b, o + 8);
    size = hi * 2 ** 32 + u32(b, o + 12);
    head = 16;
  } else if (size === 0) size = end - o;
  if (size < head || o + size > end) return null;
  return { type: name(b, o + 4), size, head };
}

function blank(b: Uint8Array, o: number, size: number, head: number) {
  // Keep the header shape (32- or 64-bit size) so the box length stays the same.
  b[o + 4] = 0x66; // f
  b[o + 5] = 0x72; // r
  b[o + 6] = 0x65; // e
  b[o + 7] = 0x65; // e
  b.fill(0, o + head, o + size);
}

function zeroTimes(b: Uint8Array, o: number, head: number, size: number) {
  const p = o + head;
  if (p + 4 > o + size) return;
  const v1 = b[p] === 1;
  const n = v1 ? 16 : 8;
  if (p + 4 + n <= o + size) b.fill(0, p + 4, p + 4 + n);
}

function movieDuration(b: Uint8Array, o: number, head: number, size: number): number | undefined {
  const p = o + head;
  if (p + 32 > o + size) return undefined;
  const v1 = b[p] === 1;
  const ts = v1 ? u32(b, p + 20) : u32(b, p + 12);
  const dur = v1 ? u32(b, p + 24) * 2 ** 32 + u32(b, p + 28) : u32(b, p + 16);
  return ts ? Math.round(dur / ts) : undefined;
}

function walk(b: Uint8Array, start: number, end: number, path: string, out: VideoInfo, depth: number) {
  let o = start;
  while (o < end) {
    const bx = box(b, o, end);
    if (!bx) break;
    const here = path ? `${path}/${bx.type}` : bx.type;
    if (META.has(bx.type)) {
      blank(b, o, bx.size, bx.head);
      out.removed.push(here);
    } else if (TIMES.has(bx.type)) {
      if (bx.type === 'mvhd') out.duration = movieDuration(b, o, bx.head, bx.size);
      zeroTimes(b, o, bx.head, bx.size);
    } else if (WALK.has(bx.type) && depth < 6) {
      walk(b, o + bx.head, o + bx.size, here, out, depth + 1);
    }
    o += bx.size;
  }
}

/** True when the bytes start like an MP4 / QuickTime file. */
export function isMp4(b: Uint8Array) {
  if (b.length < 12) return false;
  const t = name(b, 4);
  return t === 'ftyp' || t === 'moov' || t === 'mdat' || t === 'wide' || t === 'free' || t === 'skip';
}

/**
 * Scrubs metadata in place and returns what was removed plus the duration in seconds.
 * Throws if the file is not MP4 / QuickTime or has no movie box (we never send a file we could not check).
 */
export function scrubVideo(b: Uint8Array): VideoInfo {
  if (!isMp4(b)) throw new Error('not mp4');
  const out: VideoInfo = { removed: [] };
  let sawMoov = false;
  let o = 0;
  while (o < b.length) {
    const bx = box(b, o, b.length);
    if (!bx) break;
    if (bx.type === 'moov') sawMoov = true;
    o += bx.size;
  }
  if (!sawMoov) throw new Error('no moov');
  walk(b, 0, b.length, '', out, 0);
  return out;
}

const MARKS = ['\u00a9xyz', 'ISO6709', 'loci', 'GPSCoordinates', 'com.apple.quicktime.make', 'com.apple.quicktime.model'].map((m) => Array.from(m, (c) => c.charCodeAt(0) & 255));

/** Does any location / device tag remain anywhere in the file? (AC-08.7) */
export function hasLocation(b: Uint8Array) {
  return MARKS.some((m) => {
    outer: for (let i = 0; i + m.length <= b.length; i++) {
      for (let k = 0; k < m.length; k++) if (b[i + k] !== m[k]) continue outer;
      return true;
    }
    return false;
  });
}

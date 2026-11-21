// #138 F-08 R-08.17 / AC-08.7: video files leave the phone without location or device metadata.
import { describe, expect, it, jest } from '@jest/globals';
import { fromB64 } from '../src/chat/bytes';
import { hasLocation, isMp4, scrubVideo } from '../src/chat/mp4';
import { geoMov, geoUdta } from '../test-fixtures/videos';

jest.mock('../src/api/client', () => ({ api: jest.fn() }));
jest.mock('../src/chat/mediaCache', () => ({ get: jest.fn(), put: jest.fn() }));

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('scrubVideo', () => {
  it.each([
    ['mdta keys (iPhone style, moov first)', geoMov],
    ['udta ©xyz (moov after mdat)', geoUdta],
  ])('%s → no location, device or date left, same size', (_label, b64) => {
    const src = fromB64(b64);
    expect(hasLocation(src)).toBe(true);
    expect(text(src)).toContain('48.8566');
    const b = src.slice();
    const info = scrubVideo(b);
    expect(b.length).toBe(src.length);
    expect(hasLocation(b)).toBe(false);
    expect(text(b)).not.toContain('48.8566');
    expect(text(b)).not.toContain('iPhone');
    expect(info.removed.length).toBeGreaterThan(0);
    expect(info.duration).toBeGreaterThanOrEqual(1);
    // Nothing moves: sample offsets in the movie box stay valid.
    expect(text(b).indexOf('mdat')).toBe(text(src).indexOf('mdat'));
    expect(text(b).indexOf('moov')).toBe(text(src).indexOf('moov'));
  });

  it('rejects files it cannot check', () => {
    expect(() => scrubVideo(new Uint8Array([1, 2, 3]))).toThrow();
    const noMoov = new Uint8Array(16);
    noMoov.set([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]);
    expect(isMp4(noMoov)).toBe(true);
    expect(() => scrubVideo(noMoov)).toThrow('no moov');
  });
});

describe('prepare (R-08.17 limits)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const V = require('../src/chat/video') as typeof import('../src/chat/video');
  it('strips, measures and types a QuickTime file', () => {
    const v = V.prepare(fromB64(geoMov));
    expect(v.mime).toBe('video/quicktime');
    expect(v.dur).toBe(2);
    expect(hasLocation(v.bytes)).toBe(false);
  });
  it('refuses > 50 MB, > 3 min and files it cannot read', () => {
    expect(() => V.prepare(new Uint8Array(V.MAX_BYTES + 1))).toThrow('large');
    expect(() => V.prepare(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]))).toThrow('format');
    const long = fromB64(geoUdta);
    // mvhd says 1 s; the picker's length wins only when the file has none, so fake a long file via mvhd.
    const t = text(long);
    const mvhd = t.indexOf('mvhd');
    const p = mvhd + 4; // version byte
    const dur = p + 16; // v0: version/flags(4) created(4) modified(4) timescale(4) duration(4)
    const ts = (long[p + 12] << 24) | (long[p + 13] << 16) | (long[p + 14] << 8) | long[p + 15];
    const d = ts * 200;
    long.set([(d >>> 24) & 255, (d >>> 16) & 255, (d >>> 8) & 255, d & 255], dur);
    expect(() => V.prepare(long)).toThrow('long');
  });
  it('video helpers', () => {
    expect(V.isVideo({ mime: 'video/mp4' })).toBe(true);
    expect(V.isVideo({ mime: 'image/jpeg' })).toBe(false);
  });
});

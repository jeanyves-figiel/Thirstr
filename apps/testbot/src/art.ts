// Generated test photos (testing.md › Chat test bots): abstract avatars, never real people.
// A gradient, soft circles, a simple silhouette and a "TEST BOT n" label, encoded as PNG.
import zlib from 'node:zlib';

const GLYPHS: Record<string, string[]> = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Small deterministic PRNG so a bot's photos are the same on every run. */
function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export type Art = { hue: number; seed: number; label: string; dark?: boolean; w?: number; h?: number };

/** Renders one avatar as PNG bytes. */
export function avatar({ hue, seed, label, dark = false, w = 720, h = 960 }: Art): Uint8Array {
  const rnd = prng(seed);
  const top = hsl(hue, 0.7, dark ? 0.32 : 0.6);
  const bottom = hsl(hue + 45, 0.65, dark ? 0.1 : 0.24);
  const bubbles = Array.from({ length: 7 }, () => ({ x: rnd() * w, y: rnd() * h * 0.7, r: 40 + rnd() * 140, a: 0.08 + rnd() * 0.12 }));
  const sil = hsl(hue + 200, 0.25, dark ? 0.06 : 0.12);
  const cx = w * (0.42 + rnd() * 0.16);
  const head = { x: cx, y: h * 0.52, r: w * 0.16 };
  const body = { x: cx, y: h * 1.02, rx: w * 0.42, ry: h * 0.34 };
  const scale = Math.round(w / 90);
  const text = label.toUpperCase();
  const tw = text.length * 6 * scale;
  const tx = Math.round((w - tw) / 2);
  const ty = Math.round(h * 0.06);

  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      let r = top[0] + (bottom[0] - top[0]) * t;
      let g = top[1] + (bottom[1] - top[1]) * t;
      let b = top[2] + (bottom[2] - top[2]) * t;
      for (const q of bubbles) {
        const d = Math.hypot(x - q.x, y - q.y);
        if (d < q.r) {
          const a = q.a * (1 - d / q.r);
          r += (255 - r) * a;
          g += (255 - g) * a;
          b += (255 - b) * a;
        }
      }
      const inHead = Math.hypot(x - head.x, y - head.y) < head.r;
      const inBody = ((x - body.x) / body.rx) ** 2 + ((y - body.y) / body.ry) ** 2 < 1;
      if (inHead || inBody) {
        r = r * 0.25 + sil[0] * 0.75;
        g = g * 0.25 + sil[1] * 0.75;
        b = b * 0.25 + sil[2] * 0.75;
      }
      // label
      const lx = x - tx;
      const ly = y - ty;
      if (lx >= 0 && ly >= 0 && lx < tw && ly < 7 * scale) {
        const gi = Math.floor(lx / (6 * scale));
        const gx = Math.floor((lx % (6 * scale)) / scale);
        const gy = Math.floor(ly / scale);
        if (gx < 5 && GLYPHS[text[gi]]?.[gy]?.[gx] === '1') r = g = b = 255;
      }
      raw[o++] = Math.max(0, Math.min(255, r));
      raw[o++] = Math.max(0, Math.min(255, g));
      raw[o++] = Math.max(0, Math.min(255, b));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]),
  );
}

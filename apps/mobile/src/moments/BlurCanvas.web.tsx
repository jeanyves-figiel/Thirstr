// F-21 R-21.2 (#221): web (DEV) version of the Blur preview and burn-in, with a 2D canvas.
import React, { useEffect, useRef } from 'react';
import { sigmaFor, type Spot } from './blur';

const load = (uri: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = fail;
    i.src = uri;
  });

/** Draws `img` like CSS cover into w × h, then the blurred copy inside the marks. */
function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, spots: Spot[]) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, dx, dy, dw, dh);
  if (!spots.length) return;
  ctx.save();
  ctx.beginPath();
  for (const s of spots) {
    ctx.moveTo((s.x + s.rx) * w, s.y * h);
    ctx.ellipse(s.x * w, s.y * h, s.rx * w, s.ry * h, 0, 0, Math.PI * 2);
  }
  ctx.clip();
  ctx.filter = `blur(${sigmaFor(w)}px)`;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

export function BlurPreview({ uri, width, height, spots }: { uri: string; width: number; height: number; spots: Spot[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let live = true;
    load(uri)
      .then((img) => {
        const c = ref.current;
        const ctx = c?.getContext('2d');
        if (live && c && ctx) draw(ctx, img, width, height, spots);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uri, width, height, spots]);
  return React.createElement('canvas', { ref, width, height, style: { position: 'absolute', top: 0, left: 0, width, height, pointerEvents: 'none' } });
}

export async function bake(uri: string, w: number, h: number, spots: Spot[]): Promise<string> {
  if (!spots.length) return uri;
  const img = await load(uri);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('blur');
  draw(ctx, img, w, h, spots);
  return c.toDataURL('image/jpeg', 0.85);
}

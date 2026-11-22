// F-21 R-21.2 (#221): Blur preview and the burn-in before upload, drawn with Skia on the phone.
// Only the blurred JPEG leaves the phone; the sharp original is never uploaded.
import React, { useMemo } from 'react';
import { Blur, Canvas, ClipOp, Group, Image, ImageFormat, Skia, TileMode, useImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { sigmaFor, type Spot } from './blur';

const pathOf = (spots: Spot[], w: number, h: number) => {
  const b = Skia.PathBuilder.Make();
  for (const s of spots) b.addOval(Skia.XYWHRect((s.x - s.rx) * w, (s.y - s.ry) * h, s.rx * 2 * w, s.ry * 2 * h));
  return b.detach();
};

/** On-screen preview: the photo as the frame shows it (cover), blurred inside the marks. */
export function BlurPreview({ uri, width, height, spots }: { uri: string; width: number; height: number; spots: Spot[] }) {
  const img = useImage(uri);
  const clip = useMemo(() => pathOf(spots, width, height), [spots, width, height]);
  if (!img) return null;
  return (
    <Canvas style={{ position: 'absolute', top: 0, left: 0, width, height }} pointerEvents="none">
      <Image image={img} x={0} y={0} width={width} height={height} fit="cover" />
      {spots.length ? (
        <Group clip={clip}>
          <Image image={img} x={0} y={0} width={width} height={height} fit="cover">
            <Blur blur={sigmaFor(width)} mode="clamp" />
          </Image>
        </Group>
      ) : null}
    </Canvas>
  );
}

/** Burns the marks into the prepared (cropped, EXIF-free) JPEG; returns a new local file. */
export async function bake(uri: string, w: number, h: number, spots: Spot[]): Promise<string> {
  if (!spots.length) return uri;
  const img = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  const surface = Skia.Surface.Make(w, h);
  if (!img || !surface) throw new Error('blur');
  const c = surface.getCanvas();
  c.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), Skia.Paint());
  c.save();
  c.clipPath(pathOf(spots, w, h), ClipOp.Intersect, true);
  const paint = Skia.Paint();
  paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigmaFor(w), sigmaFor(w), TileMode.Clamp, null));
  c.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(0, 0, w, h), paint);
  c.restore();
  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 85);
  const out = new File(Paths.cache, `moment-blur-${Date.now()}.jpg`);
  out.create({ overwrite: true });
  out.write(bytes);
  return out.uri;
}

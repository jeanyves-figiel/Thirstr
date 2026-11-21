import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { color } from '../theme/tokens';

// F-21 R-21.9: `moment` token = coral → violet → lime (135°) when unseen, `line` when all seen.
export const MOMENT_STOPS = [color.hookup, color.friends, color.sport] as const;

function Grad({ id }: { id: string }) {
  return (
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={MOMENT_STOPS[0]} />
        <Stop offset="0.55" stopColor={MOMENT_STOPS[1]} />
        <Stop offset="1" stopColor={MOMENT_STOPS[2]} />
      </LinearGradient>
    </Defs>
  );
}

/** 2.5 pt inset ring over a rounded tile (grid card). Sizes itself to the parent. */
export function TileRing({ unseen, radius = 18, w = 2.5 }: { unseen: boolean; radius?: number; w?: number }) {
  const id = 'mr' + useId().replace(/:/g, '');
  const [box, setBox] = React.useState<{ w: number; h: number } | null>(null);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box ? (
        <Svg width={box.w} height={box.h}>
          {unseen ? <Grad id={id} /> : null}
          <Rect x={w / 2} y={w / 2} width={box.w - w} height={box.h - w} rx={radius - w / 2} fill="none" stroke={unseen ? `url(#${id})` : color.line} strokeWidth={w} />
        </Svg>
      ) : null}
    </View>
  );
}

/** Round avatar with a ring (Moments row, profile, chat header). `size` = outer diameter. */
export function RingAvatar({ size, unseen, ring = true, children }: { size: number; unseen: boolean; ring?: boolean; children: React.ReactNode }) {
  const id = 'ma' + useId().replace(/:/g, '');
  const w = size >= 56 ? 3 : 2.5;
  const gap = 2.5;
  const inner = size - 2 * (w + gap);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {ring ? (
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          {unseen ? <Grad id={id} /> : null}
          <Circle cx={size / 2} cy={size / 2} r={(size - w) / 2} fill="none" stroke={unseen ? `url(#${id})` : color.line} strokeWidth={w} />
        </Svg>
      ) : null}
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: 'hidden', backgroundColor: color.bgRaised }}>{children}</View>
    </View>
  );
}

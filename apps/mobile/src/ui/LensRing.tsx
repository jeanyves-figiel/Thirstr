import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Mode } from '../api/types';
import { color, modeColor } from '../theme/tokens';

/**
 * Ring split evenly between the lenses a profile is in (mode colours, clockwise from 12 o'clock,
 * Hookup → Friends → Sport). Children render inside, clipped round. #114 / map feedback.
 */
export function LensRing({ modes, size, stroke = 3, gap = 2, children }: { modes: Mode[]; size: number; stroke?: number; gap?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(modes.length, 1);
  const seg = c / n;
  const cut = modes.length > 1 ? Math.min(gap * 2, seg / 4) : 0;
  const inner = size - 2 * (stroke + gap);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        {(modes.length ? modes : (['hookup'] as Mode[])).map((m, i) => (
          <Circle
            key={m}
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={modes.length ? modeColor[m] : color.line}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${seg - cut} ${c - seg + cut}`}
            strokeDashoffset={-i * seg}
          />
        ))}
      </Svg>
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, overflow: 'hidden', backgroundColor: color.bgOverlay }}>{children}</View>
    </View>
  );
}

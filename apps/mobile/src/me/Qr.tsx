import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { toQR } from 'toqr';
import { color } from '../theme/tokens';

type EC = Parameters<typeof toQR>[1];
// toqr ECLevel: M 0, L 1, H 2, Q 3. H survives a centre logo (S-80, #8).
const EC_H = 2 as EC;

/** QR code (device link, share link). White quiet zone for scanners. `high`: error correction H for a centre mark. */
export function Qr({ value, size = 200, high }: { value: string; size?: number; high?: boolean }) {
  const { n, d } = useMemo(() => {
    const m = high ? toQR(value, EC_H) : toQR(value);
    const n = Math.sqrt(m.length);
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y * n + x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { n, d };
  }, [value, high]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} accessibilityLabel="QR code">
      <Rect x={0} y={0} width={n + 8} height={n + 8} fill={color.bgInverse} />
      <Path d={d} fill={color.bgBase} />
    </Svg>
  );
}

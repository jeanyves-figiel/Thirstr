import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { color } from '../theme/tokens';

// App v2 icon set (design-system.md › Iconography): 24 grid, rounded strokes. Decorative: callers label the button.
type P = { size?: number; c?: string; w?: number; fill?: string };
const base = (c: string, w: number) => ({ fill: 'none', stroke: c, strokeWidth: w, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const Icon = {
  Pin: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" {...base(c, w)} />
      <Circle cx={12} cy={10} r={2.5} {...base(c, w)} />
    </Svg>
  ),
  Moon: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" {...base(c, w)} />
    </Svg>
  ),
  Chat: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" {...base(c, w)} />
    </Svg>
  ),
  User: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={8} r={4} {...base(c, w)} />
      <Path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" {...base(c, w)} />
    </Svg>
  ),
  Filter: ({ size = 18, c = color.fgPrimary, w = 1.9 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...base(c, w)} />
      <Circle cx={16} cy={7} r={2} {...base(c, w)} />
      <Circle cx={10} cy={17} r={2} {...base(c, w)} />
    </Svg>
  ),
  Locate: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={7} {...base(c, w)} />
      <Circle cx={12} cy={12} r={2.5} {...base(c, w)} />
      <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...base(c, w)} />
    </Svg>
  ),
  Map: ({ size = 18, c = color.fgPrimary, w = 2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 4l-6 3v13l6-3 6 3 6-3V4l-6 3z" {...base(c, w)} />
      <Path d="M9 4v13M15 7v13" {...base(c, w)} />
    </Svg>
  ),
  Grid: ({ size = 17, c = color.fgPrimary, w = 2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {[
        [3, 3],
        [14, 3],
        [3, 14],
        [14, 14],
      ].map(([x, y]) => (
        <Rect key={`${x}${y}`} x={x} y={y} width={7} height={7} rx={2} {...base(c, w)} />
      ))}
    </Svg>
  ),
  Back: ({ size = 22, c = color.fgPrimary, w = 2.3 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 18l-6-6 6-6" {...base(c, w)} />
    </Svg>
  ),
  Reply: ({ size = 18, c = color.fgPrimary, w = 2.4 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11" {...base(c, w)} />
    </Svg>
  ),
  Expand: ({ size = 20, c = color.fgPrimary, w = 2.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" {...base(c, w)} />
    </Svg>
  ),
  Copy: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 9h10v10H9zM5 15V5h10" {...base(c, w)} />
    </Svg>
  ),
  Trash: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...base(c, w)} />
    </Svg>
  ),
  Archive: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4" {...base(c, w)} />
    </Svg>
  ),
  Mute: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M18 8a6 6 0 00-9.3-5M6 8c0 7-3 9-3 9h14M13.7 21a2 2 0 01-3.4 0M3 3l18 18" {...base(c, w)} />
    </Svg>
  ),
  Next: ({ size = 16, c = color.fgMuted, w = 2.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 6l6 6-6 6" {...base(c, w)} />
    </Svg>
  ),
  More: ({ size = 20, c = color.fgPrimary }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5} cy={12} r={2} fill={c} />
      <Circle cx={12} cy={12} r={2} fill={c} />
      <Circle cx={19} cy={12} r={2} fill={c} />
    </Svg>
  ),
  Star: ({ size = 24, c = color.fgPrimary, fill = 'none' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill={fill} stroke={c} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  ),
  /** Tap (F-06, #115): flame, so the star means favorite everywhere. */
  Flame: ({ size = 24, c = color.fgPrimary, fill = 'none' }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2.8c.6 3.2 4.8 5.6 4.8 10.4a4.8 4.8 0 01-9.6 0c0-2.2 1-3.6 2.2-4.6.1 1.8 1 2.9 2.1 3.2-.4-3.1-.2-6.1.5-9z" fill={fill} stroke={c} strokeWidth={2.1} strokeLinejoin="round" />
    </Svg>
  ),
  /** Private note (R-07.35). */
  Pen: ({ size = 16, c = color.personal, w = 2.4 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 20h4L19 9l-4-4L4 16v4z" {...base(c, w)} />
    </Svg>
  ),
  /** Up / down chevron by path (in-chat search R-07.39). */
  Chevron: ({ size = 20, c = color.fgPrimary, w = 2.4, d = 'M6 9l6 6 6-6' }: P & { d?: string }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} {...base(c, w)} />
    </Svg>
  ),
  Search: ({ size = 18, c = color.fgMuted, w = 2.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={11} cy={11} r={6.5} {...base(c, w)} />
      <Path d="M20 20l-4.2-4.2" {...base(c, w)} />
    </Svg>
  ),
  /** Friends (R-07.36). */
  UserPlus: ({ size = 22, c = color.friends, w = 2.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9} cy={8} r={3.6} {...base(c, w)} />
      <Path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6" {...base(c, w)} />
    </Svg>
  ),
  /** Chat translation (F-07 R-07.28): glyph + letter A. */
  Translate: ({ size = 12, c = color.trust, w = 2.4 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 5h9M8.5 3v2M6 5c.6 3.3 2.6 6 5.5 7.5M11 5c-.8 3.6-3.4 6.6-7 8" {...base(c, w)} />
      <Path d="M13 21l4-9 4 9M14.4 18h5.2" {...base(c, w)} />
    </Svg>
  ),
  Lock: ({ size = 13, c = color.trust, w = 2.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={11} width={16} height={10} rx={2} {...base(c, w)} />
      <Path d="M8 11V7a4 4 0 018 0v4" {...base(c, w)} />
    </Svg>
  ),
  Plus: ({ size = 20, c = color.fgPrimary, w = 2.3 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 5v14M5 12h14" {...base(c, w)} />
    </Svg>
  ),
  Close: ({ size = 20, c = color.fgPrimary, w = 2.3 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" {...base(c, w)} />
    </Svg>
  ),
  Send: ({ size = 20, c = color.onAccent, w = 2.4 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12h14M13 6l6 6-6 6" {...base(c, w)} />
    </Svg>
  ),
  Timer: ({ size = 13, c = color.onAccent, w = 2.4 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={13} r={8} {...base(c, w)} />
      <Path d="M12 9v4l2 2M10 2h4" {...base(c, w)} />
    </Svg>
  ),
  Check: ({ size = 14, c = color.onAccent, w = 3.2 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12l5 5 9-10" {...base(c, w)} />
    </Svg>
  ),
  Share: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" {...base(c, w)} />
    </Svg>
  ),
  Eye: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" {...base(c, w)} />
      <Circle cx={12} cy={12} r={3} {...base(c, w)} />
    </Svg>
  ),
  EyeOff: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6 0 9.5 7 9.5 7a17 17 0 01-3.2 4.1M6.3 6.4C3.9 8 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 004.3-1" {...base(c, w)} />
      <Path d="M9.9 9.9a3 3 0 004.2 4.2" {...base(c, w)} />
    </Svg>
  ),
  Flag: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 21V4M5 4h11l-2 4 2 4H5" {...base(c, w)} />
    </Svg>
  ),
  Ban: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} {...base(c, w)} />
      <Path d="M5.6 5.6l12.8 12.8" {...base(c, w)} />
    </Svg>
  ),
  Shield: ({ size = 20, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" {...base(c, w)} />
      <Path d="M8.5 12l2.5 2.5 4.5-5" {...base(c, w)} />
    </Svg>
  ),
  Bolt: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13 2L4 14h7l-1 8 9-12h-7z" {...base(c, w)} />
    </Svg>
  ),
  Home: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 11l9-7 9 7M5 9.5V20h14V9.5" {...base(c, w)} />
      <Path d="M10 20v-5h4v5" {...base(c, w)} />
    </Svg>
  ),
  Car: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM5 11h14" {...base(c, w)} />
      <Circle cx={7.5} cy={16} r={0.6} {...base(c, w)} />
      <Circle cx={16.5} cy={16} r={0.6} {...base(c, w)} />
    </Svg>
  ),
  Door: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 21h16M6 21V4l10-1v18M13 12v.5" {...base(c, w)} />
    </Svg>
  ),
  /** #189 plan types and house rules. */
  Drink: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 4h14l-7 8zM12 12v8M8 20h8" {...base(c, w)} />
    </Svg>
  ),
  Party: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5.8 11.3L2 22l10.7-3.8M8.6 8.6l6.8 6.8M22 2l-2.2.7a2 2 0 00-1.3 2.6c.4 1.1-.4 2.3-1.5 2.4L16 8M15 2h.01M22 8h.01" {...base(c, w)} />
    </Svg>
  ),
  Age: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={5} width={16} height={15} rx={3} {...base(c, w)} />
      <Path d="M4 10h16M9 3v4M15 3v4M9 15h6" {...base(c, w)} />
    </Svg>
  ),
  Pill: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={8} width={18} height={8} rx={4} {...base(c, w)} />
      <Path d="M12 8v8" {...base(c, w)} />
    </Svg>
  ),
  Vers: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" {...base(c, w)} />
    </Svg>
  ),
  Glass: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 3h8l-1 7a3 3 0 01-6 0zM12 13v8M9 21h6" {...base(c, w)} />
    </Svg>
  ),
  Toy: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 20l6-6M14 4l6 6-8 8-6-6z" {...base(c, w)} />
    </Svg>
  ),
  Shirt: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 3l4 3 4-3 4 4-3 3v11H7V10L4 7z" {...base(c, w)} />
    </Svg>
  ),
  /** #159 video check: camera with a check mark. */
  VideoCheck: ({ size = 22, c = color.fgPrimary, w = 2.1 }: P) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={2.5} y={6} width={13} height={12} rx={3} {...base(c, w)} />
      <Path d="M15.5 10.5l5-3v9l-5-3M6 12l2 2 3.5-3.5" {...base(c, w)} />
    </Svg>
  ),
};

// Pop theme (docs/spec/design-system.md, only theme). Source: /design/tokens.json.
// Rule: no hard-coded colours or sizes in app code; screens read from here or useTheme().
export const color = {
  bgBase: '#17142E',
  bgMap: '#1B1836',
  mapRoad: '#282449',
  mapRoadMinor: '#221E40',
  mapWater: '#1F3A5C',
  bgRaised: '#262248',
  bgOverlay: '#2E2A55',
  bgInverse: '#FFFFFF',
  fgPrimary: '#FFFFFF',
  fgSecondary: '#C2BDE3',
  fgMuted: '#8A86B0',
  fgSoft: '#E7E3FF',
  onAccent: '#17142E',
  line: '#39346A',
  lineSubtle: '#2E2A55',
  navInactive: '#4A4570',
  hookup: '#FF6B5B',
  friends: '#A78BFA',
  sport: '#B8F04A',
  trust: '#3DD6C3',
  trustSoft: '#3DD6C3',
  // #211 E2E chip on Chats (teal 14 % on ink).
  trustTint: 'rgba(61,214,195,0.14)',
  safety: '#3DD6C3',
  personal: '#FFC93C',
  // F-20 (#188): travel plans only (Visiting labels, visitor tiles, trip cards, Look-around bar)
  travel: '#7CC8FF',
  travelSoft: 'rgba(124,200,255,0.14)',
  warn: '#FFC93C',
  danger: '#FF4D6D',
  scrim: 'rgba(23,20,46,0.72)',
  // #113 floating header / chips over the map (ink 82 %), drop shadows, selected place halo.
  glass: 'rgba(23,20,46,0.82)',
  shadow: '#000000',
  halo: 'rgba(255,255,255,0.45)',
  // #191 exact-location consent card (coral alert on ink).
  alertBg: '#3A2330',
  alertTitle: '#FFD6D0',
  alertBody: '#F1D9D6',
  alertIcon: '#FFB4A9',
} as const;

// Photo placeholder tones, rotated by id hash.
export const tiles = ['#7A2F3B', '#4B3A8C', '#2F6B5E', '#7A5A1E', '#5B2F6E', '#2E4F8C'] as const;

export type Mode = 'hookup' | 'friends' | 'sport';
export const modeColor: Record<Mode, string> = { hookup: color.hookup, friends: color.friends, sport: color.sport };

export const font = {
  regular: 'BricolageGrotesque_400Regular',
  medium: 'BricolageGrotesque_500Medium',
  bold: 'BricolageGrotesque_700Bold',
  heavy: 'BricolageGrotesque_800ExtraBold',
} as const;

export const type = {
  display: { fontSize: 32, lineHeight: 38, fontFamily: font.heavy, letterSpacing: -1 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: font.heavy, letterSpacing: -0.6 },
  headline: { fontSize: 16, lineHeight: 21, fontFamily: font.heavy },
  body: { fontSize: 15, lineHeight: 21, fontFamily: font.regular },
  meta: { fontSize: 13, lineHeight: 18, fontFamily: font.medium },
  caption: { fontSize: 11, lineHeight: 14, fontFamily: font.heavy },
} as const;

export const space = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;
export const radius = { sm: 12, md: 22, tray: 24, lg: 32, pill: 999 } as const;
export const motion = { fast: 120, base: 220, slow: 360 } as const;
export const touch = 44;

export function tileFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return tiles[Math.abs(h) % tiles.length];
}

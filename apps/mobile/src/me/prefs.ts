// Device-only app preferences (F-17 R-17.9, concept §3 › App): units, haptics, media auto-delete, chat translation (F-07 R-07.27).
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TranslateMode = 'auto' | 'tap' | 'off';
export type Prefs = { units: 'km' | 'mi'; haptics: boolean; adultLinkPreviews?: 'blur' | 'show' | 'none'; autoDelete: boolean; translate: TranslateMode; dataSaver?: 'auto' | 'always' | 'off'; emailNudgeDone?: boolean; lensNoticeDone?: boolean };
const KEY = 'thirstr.prefs';
let cur: Prefs = { units: 'km', haptics: true, autoDelete: false, translate: 'auto' };

export const prefs = () => cur;

export async function loadPrefs() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) cur = { ...cur, ...(JSON.parse(v) as Partial<Prefs>) };
  } catch {
    /* defaults */
  }
  return cur;
}

export async function setPrefs(patch: Partial<Prefs>) {
  cur = { ...cur, ...patch };
  await AsyncStorage.setItem(KEY, JSON.stringify(cur)).catch(() => {});
  return cur;
}

const MI: Record<string, string> = {
  lt200: '< 0.1 mi',
  '200_500': '0.1–0.3 mi',
  '500_1k': '0.3–0.6 mi',
  '1_2k': '0.6–1.2 mi',
  '2_5k': '1–3 mi',
  '5_10k': '3–6 mi',
  '10k_plus': '6+ mi',
};

/** Miles variant of a distance label (km is the default in tx.distance). */
export function inMiles(d: { kind: string; m?: number; bucket?: string; floor?: boolean; approx?: boolean }): string | null {
  if (cur.units !== 'mi') return null;
  if (d.kind === 'exact') {
    const ft = (d.m ?? 0) * 3.281;
    return ft < 1000 ? `${Math.round(ft / 10) * 10} ft` : `${((d.m ?? 0) / 1609).toFixed(1)} mi`;
  }
  if (d.kind === 'city') return null;
  // #197: rounded area distance in miles (0.1 mi steps, never finer than the metric step)
  if (typeof d.m === 'number') {
    const mi = d.m / 1609;
    if (d.floor || mi < 0.1) return '< 0.1 mi';
    return `${d.approx ? '~' : ''}${mi < 10 ? (Math.floor(mi * 10) / 10).toFixed(1) : Math.floor(mi)} mi`;
  }
  return MI[d.bucket ?? ''] ?? null;
}

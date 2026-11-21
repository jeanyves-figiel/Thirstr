// F-14 R-14.1: countries that criminalise same-sex relations (de jure or de facto), ISO 3166-1
// alpha-2. Rule (owner, issue 49): ILGA World legal data plus active persecution without a law.
// Bundled snapshot of server/priv/safe_mode/countries.json; the app also downloads that file
// (same for every phone) and may only ADD countries from it, never remove (R-14.1a).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

// prettier-ignore
export const CRIMINALIZING = new Set([
  'AE', 'AF', 'BD', 'BF', 'BI', 'BN', 'CM', 'DZ', 'EG', 'ER', 'ET', 'GD', 'GH', 'GM', 'GN', 'GY', 'ID', 'IQ', 'IR', 'JM', 'KE', 'KI', 'KM', 'KW', 'LB', 'LK', 'LR', 'LY', 'MA', 'ML', 'MM', 'MR', 'MV', 'MW', 'MY', 'NG', 'OM', 'PG', 'PK', 'PS', 'QA', 'RU', 'SA', 'SB', 'SD', 'SL', 'SN', 'SO', 'SS', 'SY', 'SZ', 'TD', 'TG', 'TM', 'TN', 'TO', 'TT', 'TV', 'TZ', 'UG', 'UZ', 'VC', 'WS', 'YE', 'ZM', 'ZW',
]);

const KEY = 'thirstr.safe.remoteList';
const DAY = 24 * 3600_000;
let remote: string[] = [];

/** Bundled list plus any countries the downloaded list adds. */
export function isSafeModeCountry(c: string): boolean {
  return CRIMINALIZING.has(c) || remote.includes(c);
}

/** Loads the cached download, refreshing it at most once a day. Never removes bundled entries. */
export async function refreshSafeModeList(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const cached = raw ? (JSON.parse(raw) as { at: number; countries: string[] }) : null;
    if (cached) remote = cached.countries;
    if (cached && Date.now() - cached.at < DAY) return;
    const r = await api<{ countries: string[] }>('GET', '/safe-mode/countries');
    remote = (r.countries ?? []).filter((c) => /^[A-Z]{2}$/.test(c));
    await AsyncStorage.setItem(KEY, JSON.stringify({ at: Date.now(), countries: remote }));
  } catch {
    // offline or server unreachable: the bundled list still applies
  }
}

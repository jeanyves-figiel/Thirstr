// F-17 R-17.16 (#177) Data saver: Auto on mobile data (default) / Always / Off. Device-only.
// Auto is on with cellular and with any connection the OS marks as expensive (metered Wi-Fi,
// Android Data Saver, iOS hotspot). Never affects messages, receipts, safety, location or push.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { sv } from '../i18n/saver';
import { prefs, setPrefs } from '../me/prefs';

export type SaverMode = 'auto' | 'always' | 'off';
export type Net = { cellular: boolean; expensive: boolean; wifi: boolean };

/** Chat photos up to this size still load by themselves while saving (R-17.16). */
export const SMALL_PHOTO = 500 * 1024;

let net: Net = { cellular: false, expensive: false, wifi: true };
const subs = new Set<() => void>();
let started = false;

export function fromState(s: Pick<NetInfoState, 'type' | 'details'>): Net {
  const expensive = !!(s.details && 'isConnectionExpensive' in s.details && s.details.isConnectionExpensive);
  return { cellular: s.type === 'cellular', expensive, wifi: s.type === 'wifi' || s.type === 'ethernet' };
}

/** Pure rule: is Data saver active for this mode and network? */
export function active(mode: SaverMode, n: Net): boolean {
  if (mode === 'always') return true;
  if (mode === 'off') return false;
  return n.cellular || n.expensive;
}

export const mode = (): SaverMode => prefs().dataSaver ?? 'auto';
export const network = () => net;
/** True while Data saver is on right now. */
export const saving = () => active(mode(), net);
/** True when a big background job (chat backup, history media) may run without asking. */
export const unmetered = () => net.wifi && !net.expensive;

function emit() {
  subs.forEach((f) => f());
}

/** Start watching the network once (app start). */
export function startDataSaver() {
  if (started) return;
  started = true;
  try {
    NetInfo.addEventListener((s) => {
      net = fromState(s);
      emit();
    });
  } catch {
    // no native module (tests / web without support): stay on the Wi-Fi default
  }
}

/** Reads the network once (background launches, where the listener above never started). */
export async function refreshNetwork() {
  try {
    net = fromState(await NetInfo.fetch());
  } catch {
    // keep the last known state
  }
}

export async function setMode(m: SaverMode) {
  await setPrefs({ dataSaver: m });
  emit();
}

/** Re-renders when the mode or the network changes. */
export function useDataSaver() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return { saving: saving(), mode: mode(), net };
}

/** Row summary on the Settings hub. */
export function saverSummary(m: SaverMode, on: boolean) {
  return m === 'auto' ? (on ? sv.sumAutoOn : sv.sumAutoOff) : m === 'always' ? sv.always : sv.off;
}

export function _setNet(n: Net) {
  net = n;
  emit();
}

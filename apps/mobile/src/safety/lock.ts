// R-13.11–13 app lock: 6-digit PIN (salted SHA-256 in the encrypted device store), biometrics,
// lock after N minutes in background, optional duress PIN (decoy or wipe).
import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';
import { hex, rand } from '../chat/bytes';
import { kv } from '../chat/kv';

export type DuressAction = 'decoy' | 'wipe';
export type LockCfg = { salt: string; pin: string; bio: boolean; after: 0 | 1 | 5 | 15; duress?: string; duressAction: DuressAction; shake: boolean };
type Tries = { n: number; until: number };

const K = 'lock';
const KT = 'lock:tries';

const digest = (salt: string, pin: string) => ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, salt + ':' + pin);

export const getLock = () => kv.get<LockCfg>(K);

export async function setPin(pin: string, prev?: LockCfg | null): Promise<LockCfg> {
  const salt = prev?.salt ?? hex(rand(16));
  const cfg: LockCfg = { bio: true, after: 1, duressAction: 'decoy', shake: true, ...prev, salt, pin: await digest(salt, pin) };
  if (cfg.duress && cfg.duress === cfg.pin) delete cfg.duress;
  await kv.set(K, cfg);
  return cfg;
}

export async function setDuress(cfg: LockCfg, pin: string | null, action: DuressAction): Promise<LockCfg> {
  const d = pin ? await digest(cfg.salt, pin) : undefined;
  if (d && d === cfg.pin) throw new Error('same_pin');
  const next = { ...cfg, duress: d, duressAction: action };
  await kv.set(K, next);
  return next;
}

export const saveLock = (cfg: LockCfg) => kv.set(K, cfg);
export const clearLock = () => Promise.all([kv.del(K), kv.del(KT)]);

/** 5 free tries, then 30 s × 2ⁿ. Returns ms to wait (0 = may try). */
export async function waitMs() {
  const t = (await kv.get<Tries>(KT)) ?? { n: 0, until: 0 };
  return Math.max(0, t.until - Date.now());
}

export async function checkPin(cfg: LockCfg, pin: string): Promise<'ok' | 'duress' | 'bad' | 'wait'> {
  if ((await waitMs()) > 0) return 'wait';
  const d = await digest(cfg.salt, pin);
  if (d === cfg.pin) {
    await kv.del(KT);
    return 'ok';
  }
  if (cfg.duress && d === cfg.duress) {
    await kv.del(KT);
    return 'duress';
  }
  const t = (await kv.get<Tries>(KT)) ?? { n: 0, until: 0 };
  const n = t.n + 1;
  await kv.set(KT, { n, until: n >= 5 ? Date.now() + 30_000 * 2 ** (n - 5) : 0 });
  return 'bad';
}

export async function biometrics(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const LA = await import('expo-local-authentication');
  if (!(await LA.hasHardwareAsync()) || !(await LA.isEnrolledAsync())) return false;
  const r = await LA.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: true, cancelLabel: 'PIN' });
  return r.success;
}

/**
 * Owner check for sensitive account actions (device link R-01.6, recovery phrase R-01.7):
 * Face ID / Touch ID with the phone passcode as fallback, asked whether or not App lock is on.
 * A phone with no passcode at all has nothing to ask → true.
 */
export async function deviceAuth(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const LA = await import('expo-local-authentication');
  if ((await LA.getEnrolledLevelAsync()) === LA.SecurityLevel.NONE) return true;
  const r = await LA.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
  return r.success;
}

export async function biometricsAvailable() {
  if (Platform.OS === 'web') return false;
  const LA = await import('expo-local-authentication');
  return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync());
}

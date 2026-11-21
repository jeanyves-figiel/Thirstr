// EN-05 (#164): in-house crash and error reports, no third-party SDK.
// Anonymous: platform, build, message and stack only (no account, device or install id); the
// server scrubs and groups them. A fatal error is queued on the phone and sent on the next start,
// since the JS runtime is about to die. One session ping per start gives the crash-free rate.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildNumber } from './config';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '') + '/v1';
const KEY = 'thirstr.crashQueue';
const MAX_QUEUE = 5;
const MAX_PER_RUN = 20;

type Report = { platform: string; build: number | null; fatal: boolean; message: string; stack?: string };

let installed = false;
let sentThisRun = 0;
const seen = new Set<string>();

const platform = () => (Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web');

function toReport(e: unknown, fatal: boolean): Report {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error');
  return {
    platform: platform(),
    build: buildNumber(),
    fatal,
    message: `${err.name}: ${err.message}`.slice(0, 300),
    stack: err.stack?.slice(0, 4000),
  };
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok || (res.status >= 400 && res.status < 500); // 4xx: drop, never retry
  } catch {
    return false;
  }
}

async function queue(r: Report) {
  try {
    const q = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as Report[];
    q.push(r);
    await AsyncStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {
    // best effort
  }
}

/** Report a caught error (non-fatal). Same message is sent once per run; at most 20 per run. */
export function reportError(e: unknown, fatal = false): Promise<void> | void {
  const r = toReport(e, fatal);
  if (seen.has(r.message) || sentThisRun >= MAX_PER_RUN) return;
  seen.add(r.message);
  sentThisRun++;
  if (fatal) return queue(r);
  void post('/client/errors', r);
}

/** Send queued fatal reports from the last run, then the session ping. */
export async function flushCrashes() {
  try {
    const q = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as Report[];
    const left: Report[] = [];
    for (const r of q) if (!(await post('/client/errors', r))) left.push(r);
    await AsyncStorage.setItem(KEY, JSON.stringify(left));
  } catch {
    // best effort
  }
  await post('/client/sessions', { platform: platform() });
}

type Handler = (e: unknown, isFatal?: boolean) => void;
type ErrorUtilsT = { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void };

/** Install once at start: wraps React Native's global JS error handler. */
export function installCrashReporter() {
  if (installed || __DEV__) return;
  installed = true;
  const eu = (globalThis as unknown as { ErrorUtils?: ErrorUtilsT }).ErrorUtils;
  if (eu) {
    const prev = eu.getGlobalHandler();
    eu.setGlobalHandler((e, isFatal) => {
      const saving = reportError(e, !!isFatal);
      if (!saving) return prev(e, isFatal);
      // Let the queue write land before the default handler ends the app (max 1 s).
      const done = () => prev(e, isFatal);
      Promise.race([saving, new Promise((r) => setTimeout(r, 1000))]).then(done, done);
    });
  }
  void flushCrashes();
}

export function _reset() {
  installed = false;
  sentThisRun = 0;
  seen.clear();
}

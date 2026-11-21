// F-13 R-13.20 (#119): the running check-in outside the app.
// - iOS Live Activity (lock screen + Dynamic Island): started / updated / ended only when the check-in
//   changes. iOS draws the countdown, so nothing runs while it is on screen (EN-18).
// - App-icon quick actions that follow the check-in: idle = Start check-in, SOS; running = I'm OK, +30 min, SOS.
// - Deep links thirstr://safety/{quick,ok,more,sos,start} used by the Live Activity buttons.
// Every entry point opens the app and lands on the same screens as the in-app live bar and the
// "All good?" notification (R-13.19), so app lock and the duress PIN stay in the path (R-13.9).
import { AppState, Linking, Platform } from 'react-native';
import { useEffect } from 'react';
import { native, type LivePayload, type QuickAction, type Shortcut } from '../../modules/thirstr-safety';
import { dx } from '../i18n/date';
import * as S from './safety';

// Same as quick.ts hhmm; kept local so this file does not pull in the chat engine.
const hhmm = (d: number) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export type SafetyAction = QuickAction | 'quick';
const ACTIONS: SafetyAction[] = ['quick', 'ok', 'more', 'sos', 'start'];

/** thirstr://safety/ok → 'ok'. Anything else → null. */
export function parseSafetyLink(url: string | null | undefined): SafetyAction | null {
  const m = url?.match(/^thirstr:\/\/safety\/([a-z]+)\/?(?:[?#].*)?$/);
  const a = m?.[1] as SafetyAction | undefined;
  return a && ACTIONS.includes(a) ? a : null;
}

export type Route = { screen: 'SafetyQuick' | 'CheckinDue' | 'CheckinStart' | 'Safety'; params?: object; extend?: boolean };

/** Where each action lands. Same targets as the live bar (S-57) and the notification actions (R-13.19). */
export function routeFor(action: SafetyAction, a: S.Active | null, now = Date.now()): Route {
  if (!a) return action === 'start' ? { screen: 'CheckinStart', params: {} } : { screen: 'Safety' };
  // Past due: like the live bar, everything but +30 min goes to the due screen (S-52, has SOS too).
  if (action !== 'more' && new Date(a.due).getTime() <= now) return { screen: 'CheckinDue' };
  switch (action) {
    case 'ok':
      return { screen: 'CheckinDue' };
    case 'more':
      return a.ext < 3 ? { screen: 'SafetyQuick', extend: true } : { screen: 'SafetyQuick' };
    default:
      return { screen: 'SafetyQuick' };
  }
}

/** Live Activity content. No names, only the count of contacts (lock screen privacy). */
export function livePayload(a: S.Active, contacts: number): LivePayload {
  const due = new Date(a.due).getTime();
  const started = a.started ? new Date(a.started).getTime() : due - 2 * 3600_000;
  return {
    started: Math.min(started, due),
    due,
    title: dx.laTitle,
    sub: dx.laSub(hhmm(due), contacts),
    lateTitle: dx.barLate,
    // Same grace as the live bar: alert 15 min after due.
    lateSub: dx.barLateSub(hhmm(due + 15 * 60_000)),
    ok: dx.actOk,
    more: dx.actMore,
    sos: dx.sos,
    late: dx.laLate,
    canExtend: a.ext < 3,
  };
}

/** Quick actions for the current state (SF Symbols). */
export function shortcutsFor(a: S.Active | null): Shortcut[] {
  const sos: Shortcut = { type: 'sos', title: dx.sos, subtitle: dx.qaSosSub, symbol: 'exclamationmark.shield.fill' };
  if (!a) return [{ type: 'start', title: dx.qaStart, subtitle: dx.qaStartSub, symbol: 'shield.lefthalf.filled' }, sos];
  return [
    { type: 'ok', title: dx.actOk, subtitle: dx.due(hhmm(new Date(a.due).getTime())), symbol: 'checkmark.shield.fill' },
    ...(a.ext < 3 ? [{ type: 'more' as const, title: dx.actMore, symbol: 'clock.badge.plus' }] : []),
    sos,
  ];
}

// ------------------------------------------------------------------ sync

let lastLive = '';
let lastShortcuts = '';

async function sync(a: S.Active | null) {
  if (!native) return;
  const items = shortcutsFor(a);
  const sk = JSON.stringify(items);
  if (sk !== lastShortcuts) {
    lastShortcuts = sk;
    try {
      native.setShortcuts(items);
    } catch {
      lastShortcuts = '';
    }
  }
  if (!a) {
    lastLive = '';
    if (native.liveRunning()) await native.liveEnd().catch(() => {});
    return;
  }
  if (!native.liveSupported()) return;
  const n = (await S.contacts().catch(() => [])).filter((c) => c.accepted).length;
  const p = livePayload(a, n);
  const lk = JSON.stringify(p);
  // Only touch the activity when something shown changed (start, +30 min, contacts).
  if (lk === lastLive && native.liveRunning()) return;
  lastLive = lk;
  await native.liveSync(p).catch(() => {
    lastLive = '';
  });
}

type Nav = { isReady: () => boolean; navigate: (screen: string, params?: object) => void };

/** Mounted once in Main: keeps the Live Activity + quick actions in step and routes taps. */
export function useSafetyNative(nav: Nav) {
  useEffect(() => {
    let alive = true;
    let pending: SafetyAction | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      if (!pending || !nav.isReady() || AppState.currentState !== 'active') return false;
      const action = pending;
      pending = null;
      const r = routeFor(action, (await S.active().catch(() => null)) ?? null);
      if (r.extend) {
        S.extendCheckin().then(
          () => nav.isReady() && nav.navigate('SafetyQuick'),
          () => nav.isReady() && nav.navigate('CheckinDue'),
        );
        return true;
      }
      nav.navigate(r.screen, r.params);
      return true;
    };
    // The navigator mounts only after app lock is passed: wait for it (up to 10 min, foreground only).
    const queue = (action: SafetyAction | null) => {
      if (!action || !alive) return;
      pending = action;
      if (timer) clearInterval(timer);
      const until = Date.now() + 10 * 60_000;
      const tick = () =>
        run().then((done) => {
          if ((done || !pending || Date.now() > until) && timer) {
            clearInterval(timer);
            timer = null;
          }
        });
      timer = setInterval(tick, 400);
      tick();
    };

    // Deep links (Live Activity buttons).
    Linking.getInitialURL().then((u) => queue(parseSafetyLink(u))).catch(() => {});
    const link = Linking.addEventListener('url', (e) => queue(parseSafetyLink(e.url)));

    // Quick actions.
    let qa: { remove: () => void } | undefined;
    if (native && Platform.OS === 'ios') {
      queue(native.takeShortcut());
      qa = native.addListener('onShortcut', (e) => queue(e.type));
    }

    // State → Live Activity + quick actions.
    S.active()
      .then((a) => {
        if (alive) return sync(a ?? null);
      })
      .catch(() => {});
    const off = S.onActive((a) => {
      sync(a).catch(() => {});
    });
    // Back in the foreground: the check-in may have ended elsewhere while we slept.
    const st = AppState.addEventListener('change', (s) => {
      if (s === 'active') S.active().then((a) => sync(a ?? null)).catch(() => {});
    });

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      link.remove();
      qa?.remove();
      off();
      st.remove();
    };
  }, [nav]);
}

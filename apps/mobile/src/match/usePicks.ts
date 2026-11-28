import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Card } from '../api/types';
import { convWith } from '../chat/engine';
import type { Fields } from './fit';
import { choose, HOUR, loadState, markPicked, notForMe, saveState, windowOf, type PicksState } from './picks';
import type { PickView } from './ui';
import { recordSignal } from './signals';

// F-24 R-24.20–R-24.25 (#338): the Picks row's state on this phone. Picks come from the grid's own
// people (no request), are chosen once per window (07:00 / 19:00) and kept until the next one.
export function usePicks(items: Card[] | null, self: Fields | null, perDay: number, on: boolean) {
  const [st, setSt] = useState<PicksState | null>(null);
  // Minute clock: windows and the hourly refresh move without re-ranking on every render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [on]);
  const win = windowOf(new Date(now));
  const per = Math.ceil(perDay / 2);
  useEffect(() => {
    if (on) loadState().then(setSt);
  }, [on]);

  const byId = useMemo(() => new Map((items ?? []).map((c) => [c.id, c])), [items]);

  // New window (or first run): choose once, then remember on the phone.
  const cur = useMemo(() => {
    if (!on || !st || !self || !items?.length || per <= 0 || st.window === win.key) return st;
    const picked = choose(st, items, self, per, (id) => !!convWith(id), now).map((p) => p.person.id);
    return markPicked(st, picked, win.key, now);
  }, [on, st, self, items, per, win.key, now]);
  useEffect(() => {
    if (cur && cur !== st) saveState(cur);
  }, [cur, st]);

  const picks: PickView[] = useMemo(() => {
    if (!cur || !self || cur.window !== win.key) return [];
    const scored = choose({ ...cur, cooldown: {} }, cur.ids.map((id) => byId.get(id)).filter((c): c is Card => !!c), self, per, () => false, now);
    return scored.map((p) => ({ card: byId.get(p.person.id) as Card, fit: p.fit, learned: p.learned }));
  }, [cur, self, win.key, byId, per, now]);

  const drop = useCallback(
    (c: Card, kind: 'less' | 'not_for_me') => {
      if (!cur) return;
      recordSignal(c, kind, c.intents?.[0] ?? 'hookup');
      const next = kind === 'not_for_me' ? notForMe(cur, c.id, now) : { ...cur, ids: cur.ids.filter((x) => x !== c.id) };
      setSt(next);
      saveState(next);
    },
    [cur, now],
  );

  /** Plus: fresh picks once an hour (R-24.20). */
  const canRefresh = !!cur && now - cur.refreshedAt >= HOUR;
  const refreshInMin = cur ? Math.max(1, Math.ceil((cur.refreshedAt + HOUR - now) / 60_000)) : null;
  const refresh = useCallback(() => {
    if (!cur || !self || !items?.length) return;
    const t = Date.now();
    const picked = choose(cur, items, self, per, (id) => !!convWith(id), t).map((p) => p.person.id);
    const next = markPicked(cur, picked, win.key, t);
    setSt(next);
    setNow(t);
    saveState(next);
  }, [cur, self, items, per, win.key]);

  return { picks, total: cur?.window === win.key ? (cur.n ?? cur.ids.length) : 0, next: win.next, windowStart: win.key, drop, canRefresh, refreshInMin, refresh, ready: !!cur };
}

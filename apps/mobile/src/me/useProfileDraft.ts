// #219 R-06.8b: Edit profile autosave. Changes save 800 ms after the last edit and when the page
// is left; one save at a time, a change made during a save is saved right after it.
// "My chats" / "Only me" values stay on the device (R-06.4/R-06.6), as before.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useOptions } from '../api/options';
import type { MyProfile, Visibility } from '../api/types';
import { useSession } from '../app/session';
import { resharePrivate } from '../chat/engine';
import { tx } from '../i18n/app';
import { getLocal, setLocal } from './localFields';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const DEBOUNCE = 800;
const LOCAL: Visibility[] = ['chats', 'only_me'];

export function useProfileDraft(profileId: string | undefined) {
  const { me, refresh } = useSession();
  const options = useOptions();
  const profile: MyProfile | undefined = (me.profiles ?? []).find((p) => p.id === profileId) ?? me.profile ?? me.profiles?.[0];
  const pid = profile?.id;
  const [name, setNameS] = useState(profile?.display_name ?? '');
  const [vals, setVals] = useState<Record<string, unknown>>(profile?.fields ?? {});
  const [vis, setVisS] = useState<Record<string, Visibility>>(profile?.visibility_map ?? {});
  const [state, setState] = useState<SaveState>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string[]>>({});

  // Latest values for the debounced save; setters write here as well as to state.
  const latest = useRef({ name, vals, vis });
  const optsRef = useRef(options);
  useEffect(() => {
    optsRef.current = options;
  }, [options]);
  const dirty = useRef(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!pid) return;
    getLocal(pid).then((l) => {
      latest.current = { ...latest.current, vals: { ...latest.current.vals, ...l } };
      setVals(latest.current.vals);
    });
  }, [pid]);

  const visOf = useCallback(
    (k: string, v: Record<string, Visibility> = latest.current.vis): Visibility => v[k] ?? optsRef.current?.defaults[k]?.visibility ?? 'public',
    [],
  );

  const flush = useCallback(async (): Promise<void> => {
    const o = optsRef.current;
    if (!pid || !o || busy.current || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    busy.current = true;
    setState('saving');
    setErr(null);
    const { name: n, vals: v, vis: vm } = latest.current;
    const server: Record<string, unknown> = {};
    const local: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!o.defaults[k]) continue;
      if (LOCAL.includes(visOf(k, vm))) local[k] = x;
      else server[k] = x === undefined ? null : x;
    }
    // Clear on the server anything that moved to device-only.
    for (const k of Object.keys(local)) server[k] = null;
    let ok = false;
    try {
      await setLocal(pid, local);
      resharePrivate(pid).catch(() => {});
      const body: Record<string, unknown> = { fields: server, visibility_map: vm };
      if (n.trim()) body.display_name = n.trim();
      await api('PATCH', `/me/profiles/${pid}`, body);
      setFieldErr({});
      setState('saved');
      ok = true;
    } catch (e) {
      dirty.current = true;
      setState('error');
      if (e instanceof ApiError) {
        setErr(e.message);
        setFieldErr(e.fields ?? {});
      } else setErr(tx.common.error);
    } finally {
      busy.current = false;
    }
    // Edited while saving: save again after the pause.
    if (ok && dirty.current && timer.current === null) timer.current = setTimeout(() => flushRef.current(), DEBOUNCE);
  }, [pid, visOf]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const schedule = useCallback(() => {
    dirty.current = true;
    touched.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (busy.current) {
        timer.current = setTimeout(() => flushRef.current(), DEBOUNCE);
        return;
      }
      flush();
    }, DEBOUNCE);
  }, [flush]);

  // Leaving the page saves what is left and refreshes the hub's numbers.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const done = dirty.current ? flushRef.current() : Promise.resolve();
      if (touched.current) done.finally(() => refresh().catch(() => {}));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set = useCallback(
    (k: string, v: unknown) => {
      setVals((cur) => ({ ...cur, [k]: v }));
      latest.current = { ...latest.current, vals: { ...latest.current.vals, [k]: v } };
      schedule();
    },
    [schedule],
  );
  const setVis = useCallback(
    (k: string, v: Visibility) => {
      setVisS((cur) => ({ ...cur, [k]: v }));
      latest.current = { ...latest.current, vis: { ...latest.current.vis, [k]: v } };
      schedule();
    },
    [schedule],
  );
  const setName = useCallback(
    (v: string) => {
      setNameS(v);
      latest.current = { ...latest.current, name: v };
      schedule();
    },
    [schedule],
  );
  const retry = useCallback(() => {
    dirty.current = true;
    flush();
  }, [flush]);

  return { profile, options, name, setName, vals, set, vis, setVis, visOf: (k: string) => visOf(k, vis), state, err, fieldErr, retry, flush };
}

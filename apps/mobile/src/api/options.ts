import { useEffect, useState } from 'react';
import { api } from './client';
import type { ProfileOptions } from './types';

// GET /profile-options, cached for the app session.
let cache: ProfileOptions | null = null;
let inflight: Promise<ProfileOptions> | null = null;

export function loadOptions(): Promise<ProfileOptions> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api<ProfileOptions>('GET', '/profile-options').then((o) => (cache = o));
  return inflight;
}

export function useOptions(): ProfileOptions | null {
  const [o, setO] = useState<ProfileOptions | null>(cache);
  useEffect(() => {
    if (!o) loadOptions().then(setO).catch(() => (inflight = null));
  }, [o]);
  return o;
}

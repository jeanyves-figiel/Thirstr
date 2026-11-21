// F-21 (#212): viewer state machine (S-77). Pure, unit-tested.
import * as M from './api';
import type { Moment, MyMoment } from './api';

export type Item = Moment | MyMoment;
export type St = { pi: number; mi: number; list: Item[] | null; done: boolean; n: number; self: boolean; restart: number };
export type Act = { t: 'load'; pi: number; list: Item[] } | { t: 'next' } | { t: 'prev' } | { t: 'nextPerson' } | { t: 'remove'; id: string } | { t: 'restore'; m: Item };

export function step(s: St, a: Act): St {
  switch (a.t) {
    case 'load': {
      if (a.pi !== s.pi) return s;
      if (!a.list.length) return step(s, { t: 'nextPerson' });
      const first = s.self ? 0 : Math.max(0, a.list.findIndex((m) => !(m as Moment).seen && !M.isSeen(m.id)));
      return { ...s, list: a.list, mi: first };
    }
    case 'next':
      return s.list && s.mi < s.list.length - 1 ? { ...s, mi: s.mi + 1 } : step(s, { t: 'nextPerson' });
    // D-21a B: the viewer plays the row person after person; at the end it closes.
    case 'nextPerson':
      return !s.self && s.pi < s.n - 1 ? { ...s, pi: s.pi + 1, mi: 0, list: null } : { ...s, done: true };
    case 'prev':
      if (s.mi > 0) return { ...s, mi: s.mi - 1 };
      if (!s.self && s.pi > 0) return { ...s, pi: s.pi - 1, mi: 0, list: null };
      return { ...s, restart: s.restart + 1 };
    case 'remove': {
      const list = (s.list ?? []).filter((m) => m.id !== a.id);
      return list.length ? { ...s, list, mi: Math.min(s.mi, list.length - 1) } : { ...s, list, done: true };
    }
    case 'restore': {
      const list = [...(s.list ?? []), a.m].sort((x, y) => x.created_at.localeCompare(y.created_at));
      return { ...s, list, done: false };
    }
  }
}


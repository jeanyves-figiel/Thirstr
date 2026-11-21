import { useEffect, useReducer } from 'react';
import { on } from './engine';

/** Re-render when any of the engine topics fire. */
export function useTopics(...topics: string[]) {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const key = topics.join('|');
  useEffect(() => {
    const offs = key.split('|').map((t) => on(t, bump));
    return () => offs.forEach((o) => o());
  }, [key]);
  return tick;
}

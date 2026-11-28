import type { Mode } from '../api/types';
import { fitOf } from './fit';
import { featuresOf, learn, loadState, saveState, type Person, type Signal } from './picks';
import { getPrefs, getSelf } from './store';

// F-24 R-24.22: what I do teaches Picks, on this phone only, and only while "Learn from what I do"
// is on (R-24.30). Called from the profile actions (Tap, Favourite, Message), the chat (first reply)
// and the Picks card (Less like this, Not for me).
let queue: Promise<void> = Promise.resolve();

export function recordSignal(p: Person | null | undefined, s: Signal, lens: Mode = 'hookup'): Promise<void> {
  if (!p || !getPrefs().learn) return queue;
  const self = getSelf() ?? {};
  queue = queue.then(async () => {
    const st = await loadState();
    const x = featuresOf(p, fitOf(self, p.match ?? null, lens));
    await saveState({ ...st, model: learn(st.model, x, s) });
  }).catch(() => {});
  return queue;
}

// #247 R-07.47 / R-07.48: foreground loop for "Show me to friends" and friend-online alerts.
// Runs only while Thirstr is open (no background location, no background checks).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { currentPosition } from '../explore/location';
import * as E from './engine';
import * as floc from './friendLoc';
import * as online from './friendOnline';
import * as People from './people';

const nameOf = (peer: string) => E.convWith(peer)?.name || People.favList().find((f) => f.peer === peer)?.name || '…';

export async function friendTick(force = false) {
  const m = await floc.mine();
  if (m && m.until > Date.now()) {
    const here = await currentPosition().catch(() => null);
    await E.shareLocTick(here, force).catch(() => {});
  } else if (m) {
    await E.stopLocShare().catch(() => {});
  }
  await online.check(nameOf, force).catch(() => {});
}

export function useFriendPerks() {
  useEffect(() => {
    const run = () => AppState.currentState === 'active' && friendTick().catch(() => {});
    run();
    const t = setInterval(run, 60_000);
    const s = AppState.addEventListener('change', (st) => st === 'active' && run());
    return () => {
      clearInterval(t);
      s.remove();
    };
  }, []);
}

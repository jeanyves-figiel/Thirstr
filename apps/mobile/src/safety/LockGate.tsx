import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { Button, EmptyState, Wordmark } from '../ui';
import { biometrics, checkPin, getLock, type LockCfg, waitMs } from './lock';
import { HoldButton, PinPad } from './parts';

const Ctx = createContext<{ reload: () => void }>({ reload: () => {} });
export const useLockGate = () => useContext(Ctx);

/** Shake = two jolts over 2.3 g within 800 ms. */
function useShake(enabled: boolean, onShake: () => void) {
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let sub: { remove: () => void } | null = null;
    let last = 0;
    let alive = true;
    import('expo-sensors').then(({ Accelerometer }) => {
      if (!alive) return;
      Accelerometer.setUpdateInterval(100);
      sub = Accelerometer.addListener(({ x, y, z }) => {
        if (Math.sqrt(x * x + y * y + z * z) < 2.3) return;
        const now = Date.now();
        if (now - last < 800) onShake();
        last = now;
      });
    });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, [enabled, onShake]);
}

// R-13.12 decoy: looks like a fresh, empty Thirstr. Real data is untouched underneath.
function Decoy() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'explore' | 'chats'>('explore');
  return (
    <View testID="decoy" style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: insets.top + space.m }}>
      <View style={{ paddingHorizontal: space.l }}>
        <Wordmark />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {tab === 'explore' ? <EmptyState title={tx.safety.decoy.explore} body={tx.safety.decoy.exploreBody} /> : <EmptyState title={tx.safety.decoy.chats} />}
      </View>
      <View style={{ flexDirection: 'row', margin: space.l, marginBottom: insets.bottom + space.s, backgroundColor: color.bgInverse, borderRadius: radius.pill, padding: 6 }}>
        {(['explore', 'chats'] as const).map((k) => (
          <View key={k} style={{ flex: 1 }}>
            <Button small kind={tab === k ? 'primary' : 'ghost'} title={k === 'explore' ? tx.tabs.explore : tx.tabs.chats} onPress={() => setTab(k)} />
          </View>
        ))}
      </View>
    </View>
  );
}

// App lock gate (S-55): PIN / biometrics on launch and after N min in background; duress → decoy or wipe;
// shake + hold to wipe (R-13.13).
export function LockGate({ children }: { children: React.ReactNode }) {
  const { signOut } = useSession();
  const [cfg, setCfg] = useState<LockCfg | null | undefined>(undefined);
  const [locked, setLocked] = useState(true);
  const [decoy, setDecoy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wipeAsk, setWipeAsk] = useState(false);
  const bgAt = useRef<number | null>(null);

  const reload = useCallback(() => {
    getLock().then((c) => {
      setCfg(c);
      if (!c) setLocked(false);
    });
  }, []);
  useEffect(reload, [reload]);

  useEffect(() => {
    const s = AppState.addEventListener('change', (st) => {
      if (st === 'background') bgAt.current = Date.now();
      if (st === 'active' && cfg && bgAt.current !== null && Date.now() - bgAt.current >= cfg.after * 60_000) setLocked(true);
    });
    return () => s.remove();
  }, [cfg]);

  const tryBio = useCallback(() => {
    if (cfg?.bio) biometrics(tx.safety.lock.title).then((y) => y && (setLocked(false), setDecoy(false)));
  }, [cfg]);
  useEffect(() => {
    if (cfg && locked) tryBio();
  }, [cfg, locked, tryBio]);

  const onShake = useCallback(() => {
    setWipeAsk(true);
    setTimeout(() => setWipeAsk(false), 5000);
  }, []);
  useShake(!!cfg?.shake && !locked, onShake);

  const pin = async (p: string) => {
    if (!cfg) return;
    const r = await checkPin(cfg, p);
    if (r === 'ok') {
      setErr(null);
      setDecoy(false);
      setLocked(false);
    } else if (r === 'duress') {
      setErr(null);
      if (cfg.duressAction === 'wipe') return signOut();
      setDecoy(true);
      setLocked(false);
    } else {
      setErr(r === 'wait' ? tx.safety.lock.wait(Math.ceil((await waitMs()) / 1000)) : tx.safety.lock.wrong);
    }
  };

  if (cfg === undefined) return <View style={{ flex: 1, backgroundColor: color.bgBase }} />;
  return (
    <Ctx.Provider value={{ reload }}>
      {decoy ? <Decoy /> : children}
      {cfg && locked ? (
        <View testID="lock-screen" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.bgBase, alignItems: 'center', justifyContent: 'center', gap: space.xl }}>
          <Wordmark />
          <PinPad title={tx.safety.lock.enter} error={err} onDone={pin} extra={cfg.bio ? <Button small kind="ghost" title={tx.safety.lock.useBio} onPress={tryBio} /> : null} />
        </View>
      ) : null}
      {wipeAsk && !locked ? (
        <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: 120, padding: space.l, gap: space.m, borderRadius: radius.lg, backgroundColor: color.bgOverlay }}>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>{tx.safety.lock.wipeHold}</Text>
          <HoldButton testID="wipe-hold" label={tx.safety.lock.wipe} ms={3000} onDone={signOut} />
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

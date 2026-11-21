import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Button, Chip, Chips, Loading, Sheet, Toggle } from '../ui';
import { biometricsAvailable, clearLock, type DuressAction, getLock, type LockCfg, saveLock, setDuress, setPin } from './lock';
import { PinPad } from './parts';
import { useLockGate } from './LockGate';

type Step = null | { kind: 'pin' | 'duress'; first?: string };

// S-55 App lock settings (R-13.11–13.13).
export function AppLockScreen() {
  const gate = useLockGate();
  const [cfg, setCfg] = useState<LockCfg | null | undefined>(undefined);
  const [bio, setBio] = useState(false);
  const [step, setStep] = useState<Step>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getLock().then(setCfg);
    biometricsAvailable().then(setBio);
  }, []);

  const update = async (patch: Partial<LockCfg>) => {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    await saveLock(next);
    setCfg(next);
    gate.reload();
  };

  const entered = async (p: string) => {
    if (!step) return;
    if (!step.first) return setStep({ ...step, first: p }), setErr(null);
    if (step.first !== p) return setStep({ kind: step.kind }), setErr(tx.safety.lock.mismatch);
    try {
      const next = step.kind === 'pin' ? await setPin(p, cfg) : await setDuress(cfg!, p, cfg!.duressAction);
      setCfg(next);
      setStep(null);
      setErr(null);
      gate.reload();
    } catch {
      setStep({ kind: step.kind });
      setErr(tx.safety.lock.samePin);
    }
  };

  if (cfg === undefined) return <Loading />;
  const L = tx.safety.lock;
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, gap: space.l, paddingBottom: 120 }}>
      <Text style={{ ...type.display, color: color.fgPrimary }}>{L.title}</Text>
      <Toggle
        label={L.on}
        sub={L.onHint}
        value={!!cfg}
        tone={color.trust}
        onChange={(v) => (v ? setStep({ kind: 'pin' }) : clearLock().then(() => (setCfg(null), gate.reload())))}
      />
      {cfg ? (
        <>
          <View style={{ gap: space.m }}>
            {bio ? <Toggle label={L.bio} value={cfg.bio} tone={color.trust} onChange={(v) => update({ bio: v })} /> : null}
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{L.after}</Text>
            <Chips>
              {([0, 1, 5, 15] as const).map((m) => (
                <Chip key={m} label={L.afterOpts[m]} on={cfg.after === m} fill={color.trust} onPress={() => update({ after: m })} />
              ))}
            </Chips>
            <Button small kind="secondary" title={L.change} onPress={() => setStep({ kind: 'pin' })} />
          </View>
          <View style={{ gap: space.m }}>
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{L.duress}</Text>
            <Text style={{ ...type.meta, color: color.fgSecondary }}>{L.duressHint}</Text>
            <Text style={{ ...type.meta, color: color.fgPrimary }}>{L.duressAction}</Text>
            <Chips>
              {(['decoy', 'wipe'] as DuressAction[]).map((a) => (
                <Chip key={a} label={L[a]} on={cfg.duressAction === a} fill={a === 'wipe' ? color.danger : color.trust} onPress={() => update({ duressAction: a })} />
              ))}
            </Chips>
            {cfg.duress ? (
              <Button small kind="ghost" title={L.duressOff} onPress={() => update({ duress: undefined })} />
            ) : (
              <Button testID="duress-set" small kind="secondary" title={L.duressSet} onPress={() => setStep({ kind: 'duress' })} />
            )}
          </View>
          <Toggle label={L.shake} sub={L.shakeHint} value={cfg.shake} tone={color.danger} onChange={(v) => update({ shake: v })} />
        </>
      ) : null}
      <Sheet visible={!!step} onClose={() => setStep(null)} title={step?.kind === 'duress' ? L.duress : L.title} closeLabel={tx.common.close}>
        <PinPad title={step?.first ? L.confirmPin : L.setPin} error={err} onDone={entered} />
      </Sheet>
    </ScrollView>
  );
}

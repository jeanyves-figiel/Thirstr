import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { addPasskey } from '../auth/passkey';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { pkx } from '../i18n/passkeys';
import { deviceAuth } from '../safety/lock';
import { color, font, radius, space, type } from '../theme/tokens';
import { Button, ErrorText, Loading, Sheet } from '../ui';
import { Icon } from '../ui/icons';
import { toast } from '../ui/Toast';

// S-64c Passkeys (F-01 R-01.16, mockup approved 2026-11-22): add, list, remove.
// Provider names come from the server (AAGUID); "This phone" = ids added from this install,
// kept on the phone only.

export type Passkey = { id: string; provider: string; added_at: string; last_used_at: string | null };
const HERE = 'thirstr.passkeys.here';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function hereIds(): Promise<string[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(HERE)) ?? '[]');
  } catch {
    return [];
  }
}

/** The way back in besides passkeys, for the remove dialog ("You can still sign in with …"). */
export function otherWay(me: { has_oidc?: boolean; oidc_provider?: string | null; has_email?: boolean }): string | null {
  if (me.has_oidc) return me.oidc_provider === 'apple' ? pkx.methods.apple : me.oidc_provider === 'google' ? pkx.methods.google : pkx.methods.oidc;
  if (me.has_email) return pkx.methods.email;
  return null;
}

/** "Signed in with" row: Apple / Google first, then email, else passkey. */
export function firstMethod(me: { has_oidc?: boolean; oidc_provider?: string | null; has_email?: boolean }): string {
  return otherWay(me) ?? pkx.methods.passkey;
}

export function PasskeysScreen() {
  const { me, refresh } = useSession();
  const [list, setList] = useState<Passkey[] | null>(null);
  const [here, setHere] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Passkey | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ passkeys: Passkey[] }>('GET', '/me/passkeys').catch(() => ({ passkeys: [] as Passkey[] }));
    setList(r.passkeys);
    setHere(await hereIds());
    return r.passkeys;
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  )

  const add = async () => {
    setErr(null);
    setBusy(true);
    const before = new Set((list ?? []).map((p) => p.id));
    try {
      await addPasskey();
      const now = await load();
      const fresh = now.filter((p) => !before.has(p.id)).map((p) => p.id);
      const ids = [...(await hereIds()), ...fresh];
      await AsyncStorage.setItem(HERE, JSON.stringify(ids)).catch(() => {});
      setHere(ids);
      toast(pkx.added);
      refresh().catch(() => {});
    } catch (e) {
      if (e instanceof ApiError) setErr(e.code === 'passkey_limit' ? pkx.limit : e.message);
      else if (!/cancel/i.test(String((e as Error)?.message ?? e))) setErr(tx.common.error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Passkey) => {
    setConfirm(null);
    if (!(await deviceAuth(pkx.faceId))) return;
    try {
      await api('DELETE', `/me/passkeys/${p.id}`);
      await load();
      refresh().catch(() => {});
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'last_method' ? pkx.lastMethod : tx.common.error);
    }
  };

  if (!list) return <Loading />;
  const way = otherWay(me);
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, gap: space.l, paddingBottom: 120, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 36, color: color.fgPrimary }}>
        {pkx.title}
      </Text>
      {list.length === 0 ? (
        <View style={{ gap: space.l }}>
          <View style={{ height: 130, borderRadius: radius.tray, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Key size={60} c={color.trust} w={1.6} />
          </View>
          {[
            [pkx.p1, pkx.p1s],
            [pkx.p2, pkx.p2s],
            [pkx.p3, pkx.p3s],
          ].map(([t, s]) => (
            <View key={t} style={{ flexDirection: 'row', gap: space.m, alignItems: 'flex-start' }}>
              <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
                <Icon.Key size={16} c={color.trust} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.body, fontFamily: font.bold, color: color.fgPrimary }}>{t}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{s}</Text>
              </View>
            </View>
          ))}
          <ErrorText text={err} />
          <Button testID="passkey-add" kind="trust" title={pkx.addFirst} busy={busy} onPress={add} />
        </View>
      ) : (
        <View style={{ gap: space.m }}>
          <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
            {list.map((p, i) => (
              <View key={p.id} testID={`passkey-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m, borderTopWidth: i ? 1 : 0, borderTopColor: color.lineSubtle }}>
                <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon.Key size={20} c={color.trust} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
                    <Text style={{ ...type.body, fontFamily: font.bold, color: color.fgPrimary }}>{p.provider}</Text>
                    {here.includes(p.id) ? (
                      <Text style={{ ...type.caption, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', color: color.trust, borderWidth: 1, borderColor: color.trust, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>{pkx.thisPhone}</Text>
                    ) : null}
                  </View>
                  <Text style={{ ...type.meta, color: color.fgSecondary }}>
                    {pkx.addedOn(day(p.added_at))} · {p.last_used_at ? pkx.usedOn(day(p.last_used_at)) : pkx.neverUsed}
                  </Text>
                </View>
                <Button small kind="ghost" title={pkx.remove} testID={`passkey-remove-${i}`} onPress={() => setConfirm(p)} />
              </View>
            ))}
          </View>
          <Text style={{ ...type.meta, color: color.fgMuted, marginHorizontal: space.xs }}>{pkx.provider}</Text>
          <ErrorText text={err} />
          {list.length < 10 ? <Button testID="passkey-add" kind="ghost" title={pkx.addAnother} busy={busy} onPress={add} /> : null}
        </View>
      )}
      <Sheet visible={!!confirm} onClose={() => setConfirm(null)} title={pkx.removeTitle} closeLabel={pkx.keep}>
        <View style={{ gap: space.l }}>
          <Text style={{ ...type.body, color: color.fgSecondary }}>{way ? pkx.removeBody(way) : pkx.removeBodyNoWay}</Text>
          <Button testID="passkey-remove-confirm" kind="danger" title={pkx.remove} onPress={() => confirm && remove(confirm)} />
          <Button kind="ghost" title={pkx.keep} onPress={() => setConfirm(null)} />
        </View>
      </Sheet>
    </ScrollView>
  );
}

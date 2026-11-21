import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api, ApiError, Me, Photo } from '../api/client';
import { uploadPublicPhoto } from '../api/photoUpload';
import { o } from '../i18n/onboarding';
import { t } from '../i18n/strings';
import { STEP_OF } from '../onboarding/flow';
import { BigButton, k, StepShell } from '../onboarding/kit';
import { color, font, radius, space, tiles } from '../theme/tokens';

async function upload(profileId: string, slot: number): Promise<{ photo: Photo; account: Me } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [4, 5] });
  if (r.canceled) return null;
  const asset = r.assets[0];
  const type = asset.mimeType ?? 'image/jpeg';
  const id = await uploadPublicPhoto(profileId, slot, asset.uri, type);
  return api('POST', `/me/profiles/${profileId}/photos/${id}/check`);
}

// S-05 v2 (R-02.7): the 4:5 frame is the picker; teal scan line while checking; extras unlock after the main passes.
export function PhotoScreen({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const [main, setMain] = useState<Photo | null>(me.profile?.photos.find((p) => p.slot === 0) ?? null);
  const [extras, setExtras] = useState<Record<number, Photo>>({});
  const [account, setAccount] = useState<Me>(me);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pid = me.profile!.id;

  async function pick(slot: number) {
    setErr(null);
    setBusy(slot);
    try {
      const res = await upload(pid, slot);
      if (!res) return;
      setAccount(res.account);
      if (slot === 0) setMain(res.photo);
      else setExtras((x) => ({ ...x, [slot]: res.photo }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t.errors.generic);
    } finally {
      setBusy(null);
    }
  }

  // RF-5 (required-fields.md): the main photo can wait; the account stays invisible until it passes.
  async function later() {
    setErr(null);
    try {
      onDone(await api<Me>('POST', '/me/onboarding/photo_later'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t.errors.generic);
    }
  }

  const checking = busy === 0;
  const ok = main?.status === 'ok_main';
  const reason = main?.status === 'rejected' ? ((t.photo as Record<string, string>)[main.reject_reason ?? ''] ?? t.errors.generic) : null;
  const msg = err ?? (checking ? o.photo.checking : ok ? o.photo.ok : reason ?? o.photo.hint);
  const msgColor = err || reason ? color.danger : ok ? color.trust : color.fgSecondary;

  return (
    <StepShell
      step={STEP_OF.photo}
      title={o.photo.title}
      sub={o.photo.sub}
      scroll
      cta={{ title: ok ? o.cont : checking ? o.photo.checkingCta : o.photo.choose, testID: ok ? 'photo-continue' : 'pick-main', busy: checking, onPress: ok ? () => onDone(account) : () => pick(0) }}
      below={ok || checking ? undefined : <BigButton testID="photo-later" kind="text" title={o.photo.later} onPress={later} />}
    >
      <View style={p.row}>
        <Pressable
          testID="main-frame"
          accessibilityRole="button"
          accessibilityLabel={o.photo.add}
          onPress={checking ? undefined : () => pick(0)}
          style={({ pressed }) => [p.frame, ok ? p.frameOk : main ? p.frameSolid : p.frameEmpty, reason && { borderColor: color.danger }, pressed && k.pressed]}
        >
          {main?.url ? (
            <Image source={{ uri: main.url }} style={StyleSheet.absoluteFill} accessibilityLabel={o.photo.main} />
          ) : (
            <View style={p.empty}>
              <View style={p.plus}>
                <Plus c={color.onAccent} />
              </View>
              <Text style={p.emptyText}>{o.photo.add}</Text>
            </View>
          )}
          {checking ? <Scan /> : null}
          {ok ? (
            <View style={p.mainBadge}>
              <Text style={p.mainBadgeText}>✓ {o.photo.main}</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={p.extras}>
          {[1, 2, 3, 4].map((slot) => {
            const ph = extras[slot];
            return (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityLabel={o.photo.extra}
                accessibilityState={{ disabled: !ok }}
                onPress={ok && busy === null ? () => pick(slot) : undefined}
                style={({ pressed }) => [p.slot, ph ? { backgroundColor: tiles[slot], borderWidth: 0 } : null, !ok && { opacity: 0.4 }, pressed && ok && k.pressed]}
              >
                {ph?.url ? <Image source={{ uri: ph.url }} style={StyleSheet.absoluteFill} /> : busy === slot ? <Text style={p.emptyText}>…</Text> : <Plus c={color.fgMuted} />}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={p.msg} accessibilityLiveRegion="polite">
        <Text style={[p.msgText, { color: msgColor }]}>{msg}</Text>
      </View>
    </StepShell>
  );
}

function Scan() {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  return <Animated.View style={[p.scan, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 240] }) }] }]} />;
}

const Plus = ({ c }: { c: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.2} strokeLinecap="round">
    <Path d="M12 5v14M5 12h14" />
  </Svg>
);

const p = StyleSheet.create({
  row: { marginTop: space.s, flexDirection: 'row', gap: space.m, alignItems: 'flex-end' },
  frame: { width: 196, aspectRatio: 4 / 5, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgRaised },
  frameEmpty: { borderWidth: 2, borderStyle: 'dashed', borderColor: color.line },
  frameSolid: { borderWidth: 3, borderColor: color.line },
  frameOk: { borderWidth: 3, borderColor: color.trust },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  plus: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: font.bold, fontSize: 14, color: color.fgSecondary, textAlign: 'center' },
  scan: { position: 'absolute', left: 0, right: 0, top: 0, height: 4, backgroundColor: color.trust, shadowColor: color.trust, shadowOpacity: 0.9, shadowRadius: 12 },
  mainBadge: { position: 'absolute', left: 10, bottom: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: color.trust },
  mainBadgeText: { fontFamily: font.heavy, fontSize: 12, color: color.onAccent },
  extras: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  slot: { width: '46%', height: 76, borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderStyle: 'dashed', borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  msg: { padding: 14, borderRadius: 18, backgroundColor: color.bgRaised },
  msgText: { fontFamily: font.regular, fontSize: 14, lineHeight: 19 },
});

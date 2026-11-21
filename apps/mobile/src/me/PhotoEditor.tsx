import * as ImagePicker from 'expo-image-picker';
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api, ApiError, Me, Photo as P } from '../api/client';
import { uploadPublicPhoto } from '../api/photoUpload';
import type { MyProfile } from '../api/types';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { Banner, ErrorText, Icon, Meta, Photo } from '../ui';
import { feel } from '../ui/haptics';

const G = space.s;

// F-06 photos: slot 0 = vanilla main (R-06.2), 4 extra; reorder, replace, remove.
export type PhotoEditorHandle = { addNext: () => void };

export const PhotoEditor = forwardRef<PhotoEditorHandle, { profile: MyProfile; accent: string; onChange: (p: MyProfile) => void }>(function PhotoEditor({ profile, accent, onChange }, ref) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const picking = useRef(false);
  const live = [...profile.photos].filter((x) => x.status !== 'rejected').sort((a, b) => a.slot - b.slot);
  const rejected = profile.photos.find((x) => x.status === 'rejected');

  const reload = async () => {
    const r = await api<{ profiles: MyProfile[] }>('GET', '/me/profiles');
    const p = r.profiles.find((x) => x.id === profile.id);
    if (p) onChange(p);
  };

  async function add(slot: number) {
    // #213: one picker at a time; a failed launch shows an error instead of a dead tap.
    if (picking.current) return;
    picking.current = true;
    setErr(null);
    feel('tap');
    let r: ImagePicker.ImagePickerResult;
    try {
      r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [4, 5] });
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : tx.common.error);
      return;
    } finally {
      picking.current = false;
    }
    if (r.canceled || !r.assets?.length) return;
    setBusy(slot);
    try {
      const asset = r.assets[0];
      const ct = asset.mimeType ?? 'image/jpeg';
      const id = await uploadPublicPhoto(profile.id, slot, asset.uri, ct);
      await api<{ photo: P; account: Me }>('POST', `/me/profiles/${profile.id}/photos/${id}/check`);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(null);
    }
  }

  async function order(ids: string[]) {
    setErr(null);
    try {
      onChange(await api<MyProfile>('PUT', `/me/profiles/${profile.id}/photos/order`, { order: ids }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    }
  }

  async function remove(id: string) {
    setErr(null);
    try {
      await api('DELETE', `/me/profiles/${profile.id}/photos/${id}`);
      setSel(null);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    }
  }

  const ids = live.map((x) => x.id);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const n = [...ids];
    [n[i], n[j]] = [n[j], n[i]];
    order(n);
  };
  const selIdx = sel ? ids.indexOf(sel) : -1;
  const selected = selIdx >= 0 ? live[selIdx] : null;
  const freeSlot = [0, 1, 2, 3, 4].find((s) => !live.some((x) => x.slot === s));
  // #219: Quick wins "Add photos" opens the picker for the next free slot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ addNext: () => freeSlot !== undefined && add(freeSlot) }), [freeSlot]);

  // App v2 mosaic (issue 63): main photo big, two on the right, two wide below.
  // #213: plain flex layout (no absolute tiles, no onLayout height) so every tile hit-tests on iOS.
  const tile = (i: number, style: object) => {
    const ph = live[i];
    const r = i === 0 ? 22 : 18;
    if (!ph) {
      const loading = busy !== null && i === live.length;
      return (
        <Pressable
          key={`add${i}`}
          testID={i === live.length ? 'photo-add' : `photo-add-${i}`}
          accessibilityRole="button"
          accessibilityLabel={tx.edit.add}
          accessibilityState={{ disabled: freeSlot === undefined || busy !== null, busy: loading }}
          disabled={freeSlot === undefined || busy !== null}
          onPress={() => freeSlot !== undefined && add(freeSlot)}
          style={({ pressed }) => [
            style,
            { borderRadius: r, borderWidth: 2, borderStyle: 'dashed', borderColor: pressed ? accent : color.line, backgroundColor: pressed ? color.bgRaised : `${color.bgRaised}80`, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}
        >
          {loading ? <ActivityIndicator color={accent} /> : <Icon.Plus c={color.fgMuted} />}
        </Pressable>
      );
    }
    return (
      <Pressable
        key={ph.id}
        testID={`photo-${i}`}
        accessibilityRole="button"
        accessibilityLabel={i === 0 ? tx.edit.photoMain : `Photo ${i + 1}`}
        accessibilityState={{ selected: sel === ph.id }}
        onPress={() => {
          feel('tick');
          setSel(sel === ph.id ? null : ph.id);
        }}
        style={({ pressed }) => [style, { borderRadius: r, borderWidth: 3, borderColor: sel === ph.id ? accent : 'transparent', overflow: 'hidden', opacity: pressed ? 0.85 : 1 }]}
      >
        <Photo uri={ph.thumb_url ?? ph.url} id={ph.id} label="" style={{ width: '100%', height: '100%' }} />
        {i > 0 && ph.status !== 'pending' && ph.main_ok === false ? (
          <View style={{ position: 'absolute', left: 6, bottom: 6, height: 22, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: color.hookup, justifyContent: 'center' }}>
            <Text numberOfLines={1} style={{ ...type.caption, color: color.onAccent }}>{tx.edit.hookupOnly}</Text>
          </View>
        ) : null}
        {i === 0 || ph.status === 'pending' ? (
          <View style={{ position: 'absolute', left: 8, bottom: 8, height: 24, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: ph.status === 'pending' ? color.personal : color.bgInverse, justifyContent: 'center' }}>
            <Text style={{ ...type.caption, color: color.onAccent }}>{ph.status === 'pending' ? tx.edit.pending : tx.edit.photoMain}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ gap: space.s }}>
      {/* #219 S-74: compact grid, main photo left over two rows, 2×2 on the right. */}
      <View style={{ flexDirection: 'row', gap: G }}>
        {tile(0, { flex: 1.1 })}
        <View style={{ flex: 2, gap: G }}>
          <View style={{ flexDirection: 'row', gap: G }}>
            {tile(1, { flex: 1, aspectRatio: 1.35 })}
            {tile(2, { flex: 1, aspectRatio: 1.35 })}
          </View>
          <View style={{ flexDirection: 'row', gap: G }}>
            {tile(3, { flex: 1, aspectRatio: 1.35 })}
            {tile(4, { flex: 1, aspectRatio: 1.35 })}
          </View>
        </View>
      </View>
      <Meta>{tx.edit.photosHint}</Meta>
      {selected ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {selIdx > 0 && selected.main_ok ? <Act label={tx.edit.makeMain} onPress={() => order([selected.id, ...ids.filter((x) => x !== selected.id)])} /> : null}
          {selIdx > 1 || (selIdx === 1 && selected.main_ok) ? <Act label={tx.edit.moveEarlier} onPress={() => move(selIdx, -1)} /> : null}
          {selIdx > 0 && selIdx < ids.length - 1 ? <Act label={tx.edit.moveLater} onPress={() => move(selIdx, 1)} /> : null}
          {selIdx > 0 ? <Act label={tx.edit.remove} danger onPress={() => remove(selected.id)} /> : null}
        </View>
      ) : null}
      {busy !== null ? <Banner text={tx.edit.checking} /> : null}
      {rejected ? <Banner tone="danger" text={tx.edit.rejected[rejected.reject_reason ?? ''] ?? tx.common.error} /> : null}
      <ErrorText text={err} />
    </View>
  );
});

function Act({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ height: 40, justifyContent: 'center', paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: color.bgRaised }}>
      <Text style={{ ...type.meta, fontSize: 15, fontFamily: type.headline.fontFamily, color: danger ? color.danger : color.fgPrimary }}>{label}</Text>
    </Pressable>
  );
}

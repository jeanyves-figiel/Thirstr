// S-80 Share sheet (I-02, #8, mockup https://claude.ai/artifact/PmAkuXFdHgSc8RNaP1cHyV).
// The only place to create, share, renew or turn off the profile link.
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { api } from '../../api/client';
import { sl } from '../../i18n/shareLink';
import { color, font, radius, space, touch, type } from '../../theme/tokens';
import { afterSheet, Button, ErrorText, Sheet } from '../../ui';
import { toast } from '../../ui/Toast';
import { Qr } from '../Qr';
import { approvedMain, syncPreview } from './preview';

export type ShareState = { slug: string; url: string; short: string; show_photo: boolean; has_preview: boolean };
type Photo = { id: string; status: string; url?: string | null; thumb_url?: string | null };

export function ShareSheet({ visible, profileId, name, photos, onClose }: { visible: boolean; profileId: string; name: string; photos: Photo[] | undefined; onClose: () => void }) {
  const [share, setShare] = useState<ShareState | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'renew' | 'off' | null>(null);
  const main = approvedMain(photos);

  const refreshPreview = useCallback(
    async (s: ShareState | null | undefined) => {
      if (s && s.show_photo && !s.has_preview && main && (await syncPreview(profileId, main))) setShare({ ...s, has_preview: true });
    },
    [profileId, main],
  );

  const load = useCallback(
    () =>
      api<{ share: ShareState | null }>('GET', `/me/profiles/${profileId}/share`).then(
        (r) => {
          setShare(r.share);
          refreshPreview(r.share);
        },
        () => {
          setShare(null);
          setErr(sl.error);
        },
      ),
    [profileId, refreshPreview],
  );

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const close = () => {
    setErr(null);
    setConfirm(null);
    onClose();
  };

  const run = async (f: () => Promise<ShareState | null>) => {
    setBusy(true);
    setErr(null);
    try {
      const s = await f();
      setShare(s);
      setConfirm(null);
      refreshPreview(s);
    } catch {
      setErr(sl.error);
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(() => api<ShareState>('POST', `/me/profiles/${profileId}/share`));
  const renew = () => run(() => api<ShareState>('POST', `/me/profiles/${profileId}/share`));
  const off = () => run(() => api('DELETE', `/me/profiles/${profileId}/share`).then(() => null));
  const togglePhoto = (v: boolean) => run(() => api<ShareState>('PATCH', `/me/profiles/${profileId}/share`, { show_photo: v }));

  const copy = () => share && Clipboard.setStringAsync(share.short).then(() => toast(sl.copied), () => {});
  const send = () => {
    if (!share) return;
    // #124: the system share sheet opens only once this sheet is gone.
    close();
    afterSheet(() => Share.share({ message: share.url }).catch(() => {}));
  };

  return (
    <Sheet visible={visible} onClose={close} title={share ? sl.titleOn : sl.titleNew} closeLabel={sl.cancel}>
      {share === null ? (
        <View style={{ gap: space.l }} testID="share-new">
          <Text style={st.body}>{sl.purpose}</Text>
          <Text style={st.label}>{sl.whatSee}</Text>
          <View style={st.seeCard}>
            <View style={st.seeImg}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: main ? color.friends : color.bgOverlay, opacity: 0.55 }]} />
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={st.name}>{name}</Text>
              <Text style={st.meta}>{main ? sl.seeLine : sl.seeNameOnly}</Text>
            </View>
          </View>
          <View style={{ gap: space.s }}>
            <Point ok={false} text={sl.never} />
            <Point ok={false} text={sl.noTrack} />
            <Point ok text={sl.blocks} />
            <Point ok text={sl.offAny} />
          </View>
          <ErrorText text={err} />
          <Button testID="share-create" title={sl.create} busy={busy} onPress={create} />
        </View>
      ) : share ? (
        <View style={{ gap: space.l }} testID="share-on">
          <View style={st.qrCard}>
            <View>
              <Qr value={share.url} size={208} high />
              <View style={st.qrMark} pointerEvents="none">
                <Text style={st.qrMarkText}>
                  tr<Text style={{ color: color.hookup }}>.</Text>
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <Text style={st.qrName}>{name}</Text>
              <Text style={st.qrScan}>{sl.scan}</Text>
            </View>
          </View>

          <View style={st.linkRow}>
            <Text testID="share-url" selectable numberOfLines={1} style={st.link}>
              {share.short}
            </Text>
            <Pressable accessibilityRole="button" onPress={copy} style={st.copy} testID="share-copy">
              <Text style={st.copyText}>{sl.copy}</Text>
            </Pressable>
          </View>

          <Button testID="share-send" title={sl.share} onPress={send} />

          <View style={st.settings}>
            <View style={st.toggleRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.rowTitle}>{sl.photo}</Text>
                <Text style={st.meta}>{!main ? sl.noPhoto : share.show_photo ? '' : sl.photoOff}</Text>
              </View>
              <Switch
                testID="share-photo"
                accessibilityLabel={sl.photo}
                value={share.show_photo && !!main}
                disabled={busy || !main}
                onValueChange={togglePhoto}
                trackColor={{ true: color.trust, false: color.line }}
                thumbColor={color.bgInverse}
              />
            </View>
            {confirm ? (
              <View style={{ gap: space.s, paddingVertical: space.m }}>
                <Text style={st.meta}>{confirm === 'renew' ? sl.confirmRenew : sl.confirmOff}</Text>
                <View style={{ flexDirection: 'row', gap: space.s }}>
                  <View style={{ flex: 1 }}>
                    <Button small kind="secondary" title={sl.cancel} onPress={() => setConfirm(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button testID="share-confirm" small kind={confirm === 'off' ? 'danger' : 'primary'} busy={busy} title={confirm === 'renew' ? sl.renew : sl.off} onPress={confirm === 'renew' ? renew : off} />
                  </View>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: space.s, paddingVertical: space.m }}>
                <Pressable testID="share-renew" accessibilityRole="button" onPress={() => setConfirm('renew')} style={st.ghost}>
                  <Text style={st.ghostText}>{sl.renew}</Text>
                </Pressable>
                <Pressable testID="share-off" accessibilityRole="button" onPress={() => setConfirm('off')} style={st.ghost}>
                  <Text style={[st.ghostText, { color: color.danger }]}>{sl.off}</Text>
                </Pressable>
              </View>
            )}
          </View>
          <ErrorText text={err} />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Shield />
            <Text style={[st.meta, { flex: 1 }]}>{sl.privacy}</Text>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

function Point({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
      <Svg width={18} height={18} viewBox="0 0 18 18" accessibilityElementsHidden importantForAccessibility="no">
        {ok ? <Path d="M3.5 9.5l3.5 3.5 7.5-8" fill="none" stroke={color.trust} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : <Path d="M4 4l10 10M14 4L4 14" stroke={color.danger} strokeWidth={2} strokeLinecap="round" />}
      </Svg>
      <Text style={[st.meta, { color: color.fgSoft, flex: 1 }]}>{text}</Text>
    </View>
  );
}

function Shield() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M9 1.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V4z" fill="none" stroke={color.trust} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

const st = StyleSheet.create({
  body: { ...type.body, color: color.fgSecondary },
  label: { ...type.caption, color: color.trust, letterSpacing: 0.6, textTransform: 'uppercase' },
  meta: { ...type.meta, color: color.fgSecondary },
  name: { ...type.headline, color: color.fgPrimary },
  seeCard: { flexDirection: 'row', gap: space.l, alignItems: 'center', backgroundColor: color.bgBase, borderRadius: radius.tray, padding: space.l },
  seeImg: { width: 84, height: 108, borderRadius: 18, overflow: 'hidden', backgroundColor: color.bgOverlay },
  qrCard: { backgroundColor: color.bgInverse, borderRadius: 28, paddingVertical: space.xl, paddingHorizontal: space.xl, alignItems: 'center', gap: space.m },
  qrMark: { position: 'absolute', left: 80, top: 80, width: 48, height: 48, borderRadius: 14, backgroundColor: color.bgBase, borderWidth: 4, borderColor: color.bgInverse, alignItems: 'center', justifyContent: 'center' },
  qrMarkText: { fontFamily: font.heavy, fontSize: 17, color: color.fgPrimary, letterSpacing: -0.5 },
  qrName: { fontFamily: font.heavy, fontSize: 17, color: color.onAccent },
  qrScan: { fontFamily: font.medium, fontSize: 13, color: color.line },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: color.bgOverlay, borderRadius: 16, paddingLeft: space.l, padding: space.xs, minHeight: 52 },
  link: { ...type.body, fontFamily: font.medium, color: color.trust, flex: 1 },
  copy: { height: touch, paddingHorizontal: space.l, borderRadius: radius.sm, backgroundColor: color.line, justifyContent: 'center' },
  copyText: { ...type.headline, fontSize: 15, color: color.fgPrimary },
  settings: { backgroundColor: color.bgBase, borderRadius: 20, paddingHorizontal: space.l },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.lineSubtle },
  rowTitle: { ...type.headline, fontSize: 15, color: color.fgPrimary },
  ghost: { flex: 1, height: touch, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  ghostText: { ...type.headline, fontSize: 15, color: color.fgPrimary },
});

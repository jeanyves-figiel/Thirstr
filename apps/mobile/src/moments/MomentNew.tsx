import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/client';
import type { Mode } from '../api/types';
import { useSession } from '../app/session';
import * as E from '../chat/engine';
import * as People from '../chat/people';
import { tx } from '../i18n/app';
import { mx } from '../i18n/moments';
import { color, font, modeColor, radius, space, type } from '../theme/tokens';
import { Icon } from '../ui';
import { feel } from '../ui/haptics';
import { toast } from '../ui/Toast';
import * as M from './api';
import { CaptionPreview } from './MomentViewer';
import * as B from './blur';
import { BlurPreview, bake } from './BlurCanvas';
import { faceBoxes, faceBoxesAvailable } from '../../modules/thirstr-face';

type Nav = { goBack: () => void; navigate: (r: string, p?: object) => void; replace?: (r: string, p?: object) => void };
type Picked = { uri: string; w: number; h: number };

const CROPS: M.Crop[] = ['9:16', '4:5', '1:1'];
const STYLES: M.CaptionStyle[] = ['clean', 'pill', 'pop'];
const LENSES: Mode[] = ['hookup', 'friends', 'sport'];
const AUDS: M.Audience[] = ['everyone', 'chats', 'favorites', 'friends'];

// Remembered on the device for the session (R-21.3: last used).
let last: { audience: M.Audience; ttl: M.Ttl } = { audience: 'everyone', ttl: 86400 };

/** People I chat with = 1:1 chats where both wrote (resolved on the phone, R-21.6). */
const chatPeers = () => E.getConvs().filter((c) => !c.ctx && !c.gone && c.iWrote && c.theyWrote).map((c) => c.peer);
const favPeers = () => People.favList().map((f) => f.peer);
/** #247 R-07.44: accepted friends (resolved on the phone; the server only gets ids). */
const friendPeers = () => People.friendList('yes');

// S-76 Moment composer (F-21 R-21.1–R-21.5).
export function MomentNewScreen({ navigation }: { navigation: Nav }) {
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const closed = !!me?.hidden || !!me?.safe_mode_active || me?.safe_mode === 'on';
  const [src, setSrc] = useState<Picked | null>(null);
  const [crop, setCrop] = useState<M.Crop>('9:16');
  const [caption, setCaption] = useState('');
  const [style, setStyle] = useState<M.CaptionStyle>('clean');
  const [audience, setAudience] = useState<M.Audience>(closed && last.audience === 'everyone' ? 'chats' : last.audience);
  const [ttl, setTtl] = useState<M.Ttl>(last.ttl);
  const own = (me?.profile?.show_in ?? ['hookup']) as Mode[];
  const [lenses, setLenses] = useState<Mode[]>(own);
  const [audOpen, setAudOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // R-21.2 Blur tool (D-21c A): brush + Blur faces, burned in on the phone before upload.
  const [blurOn, setBlurOn] = useState(false);
  const [bs, setBs] = useState<B.BlurState>(B.empty);
  const [brush, setBrush] = useState<B.Brush>('m');
  const [finding, setFinding] = useState(false);
  const [ready, setReady] = useState<{ key: string; uri: string; w: number; h: number } | null>(null);
  const marks = useMemo(() => B.spots(bs), [bs]);
  const counts = useMemo(() => ({ chats: chatPeers().length, favorites: favPeers().length, friends: friendPeers().length }), []);

  async function pick(camera: boolean) {
    setErr(null);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
    }
    const r = camera ? await ImagePicker.launchCameraAsync({ ...opts, cameraType: ImagePicker.CameraType.front }) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    const a = r.assets[0];
    setSrc({ uri: a.uri, w: a.width, h: a.height });
    setBs(B.empty());
    setReady(null);
    setRejected(false);
  }

  /** Cropped, EXIF-free copy for this crop (also what face finding looks at). */
  async function prepared() {
    const key = `${src!.uri}|${crop}`;
    if (ready?.key === key) return ready;
    const r = await M.prepare(src!.uri, src!.w, src!.h, crop);
    const next = { key, ...r };
    setReady(next);
    return next;
  }

  async function findFaces() {
    if (finding) return;
    if (bs.faces) return setBs(B.blurFaces(bs));
    setFinding(true);
    try {
      const out = await prepared();
      const faces = B.facesFrom(await faceBoxes(out.uri));
      if (!faces.length) {
        setBs({ ...bs, faces: [] });
        toast(mx.noFaces);
        return;
      }
      feel('tick');
      setBs(B.blurFaces({ ...bs, faces }, faces));
    } catch {
      toast(tx.common.retry);
    } finally {
      setFinding(false);
    }
  }

  const changeCrop = () => {
    if (B.count(bs) || bs.faces) toast(mx.blurCleared);
    setBs(B.empty());
    setCrop(CROPS[(CROPS.indexOf(crop) + 1) % CROPS.length]);
  };

  async function shareNow() {
    if (!src || busy) return;
    const ids = audience === 'chats' ? chatPeers() : audience === 'favorites' ? favPeers() : audience === 'friends' ? friendPeers() : [];
    if (audience !== 'everyone' && !ids.length) return setErr(mx.nobody);
    setBusy(true);
    setErr(null);
    try {
      const out = await prepared();
      const uri = marks.length ? await bake(out.uri, out.w, out.h, marks) : out.uri;
      const res = await M.share(uri, { audience, audience_ids: ids, ttl_s: ttl, intents: lenses, caption, caption_style: style });
      last = { audience, ttl };
      if (res.status === 'rejected') {
        feel('warning');
        setRejected(true);
        return;
      }
      feel('success');
      const narrowed = lenses.some((l) => l !== 'hookup') && res.main_ok === false;
      toast(res.status === 'review' ? mx.review : narrowed ? mx.hookupOnly : mx.shared);
      navigation.goBack();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  }

  if (!me?.verified) {
    return (
      <Shell onClose={navigation.goBack} insets={insets}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.l, padding: space.xxl }}>
          <Icon.Shield c={color.trust} size={36} />
          <Text style={{ ...type.title, color: color.fgPrimary, textAlign: 'center' }}>{mx.verify}</Text>
          <Big label={mx.verifyCta} fill={color.trust} onPress={() => navigation.navigate('Verify')} />
        </View>
      </Shell>
    );
  }

  if (!src) {
    return (
      <Shell onClose={navigation.goBack} insets={insets} title={mx.newTitle}>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xxl, gap: space.xl }}>
          <Text style={{ ...type.body, color: color.fgSecondary, textAlign: 'center' }}>{mx.pickHint}</Text>
          <Pressable testID="moment-camera" accessibilityRole="button" onPress={() => pick(true)} style={{ alignSelf: 'center', width: 96, height: 96, borderRadius: 48, borderWidth: 5, borderColor: color.fgPrimary, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: color.hookup }} />
          </Pressable>
          <Text style={{ ...type.caption, color: color.fgSecondary, textAlign: 'center' }}>{mx.camera}</Text>
          <Big testID="moment-library" label={mx.library} fill={color.bgRaised} ink={color.fgPrimary} onPress={() => pick(false)} />
          <Text style={{ ...type.meta, color: color.trust, textAlign: 'center' }}>{mx.privacyNote}</Text>
        </View>
      </Shell>
    );
  }

  if (rejected) {
    return (
      <Shell onClose={navigation.goBack} insets={insets}>
        <View style={{ flex: 1, justifyContent: 'flex-end', padding: space.xl, paddingBottom: insets.bottom + space.xl, gap: space.l }}>
          <Image source={{ uri: src.uri }} blurRadius={40} style={{ position: 'absolute', width, height, opacity: 0.5 }} />
          <Text style={{ ...type.title, color: color.fgPrimary }}>{mx.rejectedTitle}</Text>
          <Text style={{ ...type.body, color: color.fgSecondary }}>{mx.rejectedBody}</Text>
          <View style={{ backgroundColor: color.bgRaised, borderRadius: 18, padding: space.m, flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
            <Icon.Lock size={20} c={color.friends} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{mx.rejectedAlbum}</Text>
              <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{mx.rejectedAlbumSub}</Text>
            </View>
          </View>
          <Big label={mx.openAlbums} fill={color.friends} onPress={() => navigation.navigate('Albums')} />
          <Pressable accessibilityRole="button" onPress={() => setSrc(null)} style={{ alignSelf: 'center', padding: space.m }}>
            <Text style={{ ...type.headline, fontSize: 14, color: color.fgSecondary }}>{mx.editAgain}</Text>
          </Pressable>
        </View>
      </Shell>
    );
  }

  const ratio = crop === '9:16' ? 9 / 16 : crop === '4:5' ? 4 / 5 : 1;
  const frameW = Math.min(width, (height * 0.62) * ratio);
  const frameH = frameW / ratio;
  const lensLabel = lenses.map((l) => tx.modes[l]).join(', ');

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.shadow }}>
      <View style={{ paddingTop: insets.top + space.s, alignItems: 'center' }}>
        <View style={{ width: frameW, height: frameH, borderRadius: 22, overflow: 'hidden', backgroundColor: color.bgRaised }}>
          <Image source={{ uri: src.uri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} accessibilityLabel={mx.newTitle} />
          {marks.length ? <BlurPreview uri={src.uri} width={frameW} height={frameH} spots={marks} /> : null}
          {blurOn ? (
            <View
              testID="moment-blur-canvas"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(e) => {
                const x = e.nativeEvent.locationX / frameW;
                const y = e.nativeEvent.locationY / frameH;
                const f = B.faceAt(bs, x, y);
                if (f >= 0 && bs.faces?.[f].on) setBs(B.toggleFace(bs, f));
                else setBs(B.begin(bs, x, y, brush, frameW / frameH));
              }}
              onResponderMove={(e) => setBs((cur) => B.extend(cur, e.nativeEvent.locationX / frameW, e.nativeEvent.locationY / frameH, brush, frameW / frameH))}
            />
          ) : null}
          {caption.trim() ? <CaptionPreview text={caption.trim()} style={style} top={frameH * 0.58} /> : null}
        </View>
        {/* tools: crop ratios, caption style */}
        <View style={{ position: 'absolute', top: insets.top + space.l, right: space.l, gap: space.s }}>
          <Pressable accessibilityRole="button" accessibilityLabel={mx.close} onPress={navigation.goBack} style={tool(false)}>
            <Icon.Close />
          </Pressable>
          <Pressable testID="moment-crop" accessibilityRole="button" accessibilityLabel={`${mx.crop} ${crop}`} onPress={changeCrop} style={tool(false)}>
            <Text style={{ fontFamily: font.heavy, fontSize: 10.5, color: color.fgPrimary }}>{crop}</Text>
          </Pressable>
          <Pressable testID="moment-blur" accessibilityRole="button" accessibilityState={{ selected: blurOn }} accessibilityLabel={mx.blur} onPress={() => setBlurOn(!blurOn)} style={tool(false, blurOn)}>
            <Text style={{ fontFamily: font.heavy, fontSize: 10, color: blurOn ? color.onAccent : color.fgPrimary }}>{mx.blur}</Text>
          </Pressable>
          <Pressable testID="moment-style" accessibilityRole="button" accessibilityLabel={`${mx.caption}: ${mx.styles[style]}`} onPress={() => setStyle(STYLES[(STYLES.indexOf(style) + 1) % STYLES.length])} style={tool(style !== 'clean')}>
            <Text style={{ fontFamily: font.heavy, fontSize: 15, color: style !== 'clean' ? color.onAccent : color.fgPrimary }}>Aa</Text>
          </Pressable>
        </View>
      </View>
      {blurOn ? (
        <BlurTray
          state={bs}
          brush={brush}
          finding={finding}
          faces={faceBoxesAvailable}
          bottom={insets.bottom}
          onFaces={findFaces}
          onKeep={(k) => setBs(B.setKeepMine(bs, k))}
          onBrush={setBrush}
          onUndo={() => setBs(B.undo(bs))}
          onDone={() => setBlurOn(false)}
        />
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ backgroundColor: color.bgOverlay, borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -26, padding: space.l, paddingBottom: insets.bottom + space.l, gap: space.m, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <TextInput
          testID="moment-caption"
          value={caption}
          onChangeText={(t) => setCaption(t.replace(/\n/g, ' ').slice(0, 80))}
          placeholder={mx.captionPh}
          placeholderTextColor={color.fgMuted}
          maxLength={80}
          style={{ ...type.body, color: color.fgPrimary, backgroundColor: color.bgRaised, borderRadius: radius.pill, paddingHorizontal: space.l, height: 44 }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          <Pill testID="moment-aud" label={`👁 ${mx.aud[audience]}`} fill={color.trust} onPress={() => setAudOpen(!audOpen)} />
          <Pill testID="moment-ttl" label={`⏱ ${mx.ttl[ttl]}`} fill={color.personal} onPress={() => setTtl(M.TTLS[(M.TTLS.indexOf(ttl) + 1) % M.TTLS.length])} />
        </View>
        {audOpen ? (
          <View style={{ gap: space.s }}>
            {AUDS.map((a) => {
              const off = a === 'everyone' && closed;
              const on = audience === a;
              const sub = a === 'everyone' ? (off ? mx.hiddenOnly : mx.audSub.everyone) : mx.audSub[a](counts[a]);
              return (
                <Pressable key={a} testID={`aud-${a}`} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} disabled={off} onPress={() => { setAudience(a); setAudOpen(false); }} style={{ opacity: off ? 0.45 : 1, flexDirection: 'row', alignItems: 'center', gap: space.m, backgroundColor: color.bgRaised, borderRadius: 16, padding: space.m }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.headline, fontSize: 14, color: color.fgPrimary }}>{mx.aud[a]}</Text>
                    <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{sub}</Text>
                  </View>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: on ? 6 : 2, borderColor: on ? color.trust : color.line }} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
          <Text style={{ ...type.caption, color: color.fgMuted }}>{mx.shownIn}</Text>
          {LENSES.map((l) => {
            const on = lenses.includes(l);
            return (
              <Pressable
                key={l}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setLenses(on ? (lenses.length > 1 ? lenses.filter((x) => x !== l) : lenses) : LENSES.filter((x) => x === l || lenses.includes(x)))}
                style={{ height: 34, paddingHorizontal: space.m, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: on ? modeColor[l] : 'transparent', borderWidth: 1.5, borderColor: on ? modeColor[l] : color.line }}
              >
                <Text style={{ ...type.caption, fontSize: 12, color: on ? color.onAccent : color.fgSecondary }}>{tx.modes[l]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{mx.preview(mx.aud[audience], mx.ttl[ttl], lensLabel)}</Text>
        {err ? <Text style={{ ...type.meta, color: color.danger }}>{err}</Text> : null}
        <Pressable
          testID="moment-share"
          accessibilityRole="button"
          disabled={busy}
          onPress={shareNow}
          style={{ height: 54, borderRadius: radius.pill, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.s, shadowColor: color.hookup, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } }}
        >
          {busy ? <ActivityIndicator color={color.onAccent} /> : null}
          <Text style={{ ...type.headline, color: color.onAccent }}>{busy ? mx.sharing : mx.share}</Text>
        </Pressable>
        <Text style={{ ...type.meta, fontSize: 12, color: color.trust }}>{mx.privacyNote}</Text>
      </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const tool = (on: boolean, teal = false) => ({ width: 42, height: 42, borderRadius: 21, backgroundColor: teal ? color.trust : on ? color.hookup : 'rgba(23,20,46,0.62)', alignItems: 'center' as const, justifyContent: 'center' as const });

const SIZES: { k: B.Brush; dot: number }[] = [
  { k: 's', dot: 6 },
  { k: 'm', dot: 11 },
  { k: 'l', dot: 16 },
];

/** D-21c A: the Blur tray under the photo (Blur faces, Keep mine, brush sizes, Undo, Done). */
function BlurTray(p: {
  state: B.BlurState;
  brush: B.Brush;
  finding: boolean;
  faces: boolean;
  bottom: number;
  onFaces: () => void;
  onKeep: (k: boolean) => void;
  onBrush: (b: B.Brush) => void;
  onUndo: () => void;
  onDone: () => void;
}) {
  const n = B.count(p.state);
  return (
    <View testID="moment-blur-tray" style={{ flex: 1, backgroundColor: color.bgOverlay, borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -26, padding: space.l, paddingBottom: p.bottom + space.l, gap: space.m }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{mx.blur}</Text>
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{mx.blurred(n)}</Text>
      </View>
      {p.faces ? (
        <>
          <Pressable testID="moment-blur-faces" accessibilityRole="button" disabled={p.finding} onPress={p.onFaces} style={{ height: 44, borderRadius: radius.pill, backgroundColor: color.bgRaised, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.s }}>
            {p.finding ? <ActivityIndicator color={color.fgPrimary} /> : null}
            <Text style={{ ...type.headline, fontSize: 13, color: color.fgPrimary }}>{p.finding ? mx.findingFaces : mx.blurFaces}</Text>
          </Pressable>
          <Pressable testID="moment-keep-mine" accessibilityRole="switch" accessibilityState={{ checked: p.state.keepMine }} onPress={() => p.onKeep(!p.state.keepMine)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color.bgRaised, borderRadius: 14, paddingHorizontal: space.m, paddingVertical: space.s + 2 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, fontSize: 13, color: color.fgPrimary }}>{mx.keepMine}</Text>
              <Text style={{ ...type.meta, fontSize: 11.5, color: color.fgSecondary }}>{mx.keepMineSub}</Text>
            </View>
            <View style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: p.state.keepMine ? color.trust : color.line, padding: 3, alignItems: p.state.keepMine ? 'flex-end' : 'flex-start' }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color.fgPrimary }} />
            </View>
          </Pressable>
        </>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {SIZES.map(({ k, dot }) => {
            const on = p.brush === k;
            return (
              <Pressable key={k} testID={`moment-brush-${k}`} accessibilityRole="radio" accessibilityLabel={mx.brush[k]} accessibilityState={{ checked: on }} onPress={() => p.onBrush(k)} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: on ? color.trust : color.line, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color.fgPrimary }} />
              </Pressable>
            );
          })}
        </View>
        <Pressable testID="moment-blur-undo" accessibilityRole="button" disabled={!p.state.history.length} onPress={p.onUndo} style={{ height: 44, paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, justifyContent: 'center', opacity: p.state.history.length ? 1 : 0.45 }}>
          <Text style={{ ...type.headline, fontSize: 13, color: color.fgPrimary }}>{`↶ ${mx.undo}`}</Text>
        </Pressable>
      </View>
      <Pressable testID="moment-blur-done" accessibilityRole="button" onPress={p.onDone} style={{ height: 48, borderRadius: radius.pill, backgroundColor: color.fgPrimary, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...type.headline, color: color.onAccent }}>{mx.done}</Text>
      </Pressable>
    </View>
  );
}

function Shell({ children, onClose, insets, title }: { children: React.ReactNode; onClose: () => void; insets: { top: number }; title?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <View style={{ paddingTop: insets.top + space.s, paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Pressable accessibilityRole="button" accessibilityLabel={mx.close} onPress={onClose} style={tool(false)}>
          <Icon.Close />
        </Pressable>
        {title ? <Text style={{ ...type.title, color: color.fgPrimary }}>{title}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Pill({ label, fill, onPress, testID }: { label: string; fill: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{ height: 36, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: fill, justifyContent: 'center' }}>
      <Text style={{ ...type.caption, fontSize: 12, color: color.onAccent }}>{label}</Text>
    </Pressable>
  );
}

function Big({ label, fill, ink = color.onAccent, onPress, testID }: { label: string; fill: string; ink?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{ height: 52, borderRadius: radius.pill, backgroundColor: fill, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' }}>
      <Text style={{ ...type.headline, color: ink }}>{label}</Text>
    </Pressable>
  );
}

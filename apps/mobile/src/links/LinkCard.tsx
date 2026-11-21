// I-01 S-63c (#17): link card in chat + "Open ‹host›?" sheet. The receiver's phone makes no call
// to the platform: only the encrypted thumbnail comes from our media storage (R-I01.33).
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, Text, View } from 'react-native';
import { api } from '../api/client';
import { useSession } from '../app/session';
import type * as E from '../chat/engine';
import { decryptToUri } from '../chat/media';
import { kv } from '../chat/kv';
import { lx } from '../i18n/links';
import { prefs } from '../me/prefs';
import { color, radius, space, type } from '../theme/tokens';
import { toast } from '../ui/Toast';
import { adultAllowed, displayHost, GLYPH, isAdult, PLATFORM_NAME, trust, trusted, type Platform } from './links';

export function Glyph({ p, size = 24 }: { p: Platform; size?: number }) {
  const g = GLYPH[p] ?? GLYPH.web;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: g.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: g.fg, fontSize: g.t.length > 2 ? size * 0.34 : size * 0.46, fontWeight: '800' }}>{g.t}</Text>
    </View>
  );
}

const hiddenIds = new Set<string>();
let hiddenLoaded = false;
async function loadHidden() {
  if (hiddenLoaded) return;
  hiddenLoaded = true;
  for (const id of (await kv.get<string[]>('links.hiddenCards')) ?? []) hiddenIds.add(id);
}

/** R-I01.9: blur when adult platform, Bluesky label, or the person's setting says so. */
export function blurFor(p: E.LinkPreview): 'blur' | 'show' | 'none' {
  const setting = prefs().adultLinkPreviews ?? 'blur';
  const adult = isAdult(p.platform as Platform) || !!p.labels?.length;
  if (!adult) return 'show';
  return setting === 'show' ? 'show' : setting === 'none' ? 'none' : 'blur';
}

export function LinkCard({ m, p, mine, peer }: { m: E.Msg; p: E.LinkPreview; mine: boolean; peer?: string | null }) {
  const { me } = useSession();
  const platform = (p.platform as Platform) ?? 'web';
  // R-I01.28 / R-I01.30: Safe Mode or the store-review build → host only.
  const bare = isAdult(platform) && !adultAllowed(me.safe_mode === 'on' || !!me.safe_mode_active);
  const [uri, setUri] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [hidden, setHidden] = useState(false);
  const mode = mine ? 'show' : blurFor(p);

  useEffect(() => {
    loadHidden().then(() => setHidden(hiddenIds.has(m.id)));
  }, [m.id]);
  useEffect(() => {
    if (!p.thumb || bare || mode === 'none') return;
    decryptToUri(p.thumb).then(setUri, () => {});
  }, [p.thumb, bare, mode]);

  if (hidden) return <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.hiddenCard}</Text>;

  const host = displayHost(p.url).host;
  const head = bare ? host : p.author || p.title || host;
  const w = 260;
  const h = p.thumb?.w && p.thumb?.h ? Math.min(200, Math.max(110, Math.round((w * p.thumb.h) / p.thumb.w))) : 150;
  const blurred = mode === 'blur' && !reveal;

  const report = async (reason: 'non_consensual' | 'spam_bot') => {
    setOpen(false);
    if (!peer || !m.raw || !m.fk) return;
    // R-I01.24: franked message (url, title, text only); card hidden for me at once.
    await api('POST', '/reports', { profile_id: peer, reason, context: 'chat', messages: [{ plain: m.raw, fk: m.fk }] }).catch(() => {});
    hiddenIds.add(m.id);
    await kv.set('links.hiddenCards', [...hiddenIds].slice(-500));
    setHidden(true);
    toast(lx.reported);
  };

  const tap = async () => {
    const d = displayHost(p.url);
    if ((platform === 'x' || platform === 'bluesky') && !d.mixed && (await trusted(d.host))) {
      Linking.openURL(p.url).catch(() => {});
      return;
    }
    setOpen(true);
  };

  return (
    <View style={{ gap: space.xs }}>
      {p.msg ? <Text style={{ ...type.body, color: mine ? color.onAccent : color.fgPrimary }}>{p.msg}</Text> : null}
      <Pressable
        testID="link-card"
        onPress={tap}
        accessibilityRole="link"
        accessibilityLabel={`${PLATFORM_NAME[platform] || host}: ${head}. ${lx.open}`}
        style={{ width: w, backgroundColor: color.bgRaised, borderRadius: radius.md, borderWidth: 1, borderColor: color.line, overflow: 'hidden' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 }}>
          <Glyph p={platform} />
          <Text numberOfLines={1} style={{ ...type.headline, fontSize: 14, color: color.fgPrimary, flexShrink: 1 }}>
            {head}
          </Text>
          <Text numberOfLines={1} style={{ ...type.meta, color: color.fgSecondary, flexShrink: 0 }}>
            {host}
          </Text>
        </View>
        {uri && !bare ? (
          <Pressable disabled={!blurred} onPress={() => setReveal(true)} accessibilityRole={blurred ? 'button' : undefined} accessibilityLabel={blurred ? lx.tapToView : undefined}>
            <Image source={{ uri }} style={{ width: w, height: h }} blurRadius={blurred ? 40 : 0} resizeMode="cover" accessibilityIgnoresInvertColors />
            {blurred ? (
              <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(23,20,46,0.45)' }}>
                <View style={{ backgroundColor: color.bgInverse, borderRadius: 18, paddingHorizontal: 14, height: 36, justifyContent: 'center' }}>
                  <Text style={{ ...type.caption, fontSize: 13, color: color.onAccent }}>{lx.tapToView}</Text>
                </View>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        {p.text && !bare ? (
          <Pressable onPress={() => setMore((v) => !v)} accessibilityRole="button" accessibilityLabel={lx.more}>
            <Text numberOfLines={more ? undefined : 4} style={{ ...type.body, fontSize: 14, lineHeight: 20, color: color.fgPrimary, paddingHorizontal: 12, paddingVertical: 8 }}>
              {p.text}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: color.line, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{host}</Text>
          <Text style={{ ...type.meta, color: color.trust, fontWeight: '800' }}>{lx.open}</Text>
        </View>
      </Pressable>
      <OpenSheet url={open ? p.url : null} platform={platform} onClose={() => setOpen(false)} onReport={!mine && peer ? report : undefined} />
    </View>
  );
}

/** R-I01.10: full URL, Open (system: platform app or browser, never an in-app web view), Copy, Cancel. */
export function OpenSheet({ url, platform, onClose, onReport }: { url: string | null; platform: Platform; onClose: () => void; onReport?: (r: 'non_consensual' | 'spam_bot') => void }) {
  const [remember, setRemember] = useState(false);
  if (!url) return null;
  const d = displayHost(url);
  const rest = url.replace(/^https:\/\/(www\.)?[^/]+/, '');
  const canRemember = (platform === 'x' || platform === 'bluesky') && !d.mixed;
  const go = async () => {
    if (remember && canRemember) await trust(d.host);
    onClose();
    Linking.openURL(url).catch(() => {});
  };
  const btn = { height: 48, borderRadius: 24, borderWidth: 1, borderColor: color.line, alignItems: 'center' as const, justifyContent: 'center' as const, flex: 1 };
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel={lx.cancel} onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(10,8,22,0.6)' }} />
      <View style={{ backgroundColor: color.bgRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.l, paddingBottom: 34, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Glyph p={platform} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.title, color: color.fgPrimary }}>{lx.openTitle(d.host)}</Text>
            <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.openSub(PLATFORM_NAME[platform] || null)}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: color.bgBase, borderRadius: 14, padding: 12 }}>
          <Text selectable style={{ ...type.body, fontSize: 14, color: color.fgSecondary }}>
            <Text style={{ color: color.fgPrimary, fontWeight: '800' }}>{d.host}</Text>
            {rest}
          </Text>
        </View>
        {d.mixed ? <Text style={{ ...type.meta, color: color.warn }}>{lx.mixed}</Text> : null}
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.openNote}</Text>
        {canRemember ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: remember ? color.trust : color.line, backgroundColor: remember ? color.trust : 'transparent' }} />
            <Text style={{ ...type.body, color: color.fgPrimary }}>{lx.dontAsk(d.host)}</Text>
          </Pressable>
        ) : null}
        <Pressable testID="link-open" accessibilityRole="button" onPress={go} style={{ height: 56, borderRadius: 28, backgroundColor: color.bgInverse, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...type.headline, fontSize: 17, color: color.onAccent }}>{lx.open}</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Pressable
            accessibilityRole="button"
            style={btn}
            onPress={() => {
              Clipboard.setStringAsync(url).then(() => toast(lx.copied), () => {});
              onClose();
            }}
          >
            <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{lx.copy}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={btn} onPress={onClose}>
            <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{lx.cancel}</Text>
          </Pressable>
        </View>
        {onReport ? (
          <View style={{ borderTopWidth: 1, borderTopColor: color.line, paddingTop: 6 }}>
            {(
              [
                ['non_consensual', lx.reportConsent],
                ['spam_bot', lx.reportSpam],
              ] as const
            ).map(([r, label]) => (
              <Pressable key={r} accessibilityRole="button" onPress={() => onReport(r)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ ...type.body, color: color.danger }}>⚑ {label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

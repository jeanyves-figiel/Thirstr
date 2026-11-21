// I-01 S-44 (#17): share a post into up to 5 chats. Opened by the iOS share extension
// (thirstr://share?url=…) after App lock, so the duress PIN still applies (R-I01.1).
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../app/session';
import * as E from '../chat/engine';
import { useTopics } from '../chat/hooks';
import { lx } from '../i18n/links';
import { color, font, space, type } from '../theme/tokens';
import { Icon, Photo } from '../ui';
import { feel } from '../ui/haptics';
import { toast } from '../ui/Toast';
import { LinkCard } from './LinkCard';
import { firstUrl, MAX_CHATS } from './links';
import { buildPreview, type Preview } from './preview';
import { canShareTo, shareTo } from './share';

type Props = { route: { params: { url: string } }; navigation: { goBack: () => void; replace: (n: string, p: object) => void } };

export function ShareSheetScreen({ route, navigation }: Props) {
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  useTopics('convs');
  const url = useMemo(() => firstUrl(route.params.url ?? '') ?? null, [route.params.url]);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;

  useEffect(() => {
    if (url) buildPreview(url).then(setPrev);
  }, [url]);

  const convs = E.getConvs().filter((c) => !c.archived && !c.gone);
  const shown = (q.trim() ? convs.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())) : convs).slice(0, 20);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_CHATS ? s : [...s, id]));

  const send = async () => {
    if (!prev || !sel.length) return;
    setBusy(true);
    try {
      const r = await shareTo(sel, prev, msg, safe);
      if (r.limited) {
        toast(lx.daily);
        return;
      }
      feel('success');
      toast(r.asText ? lx.notAvailable : r.creatorNote ? lx.creatorNote : lx.sent(r.sent));
      if (sel.length === 1) navigation.replace('Chat', { cid: sel[0] });
      else navigation.goBack();
    } finally {
      setBusy(false);
    }
  };

  const fake: E.Msg | null = prev ? { id: 'preview', from: 'them', at: 0, p: { t: 'link.preview', url: prev.url, host: prev.host, platform: prev.platform, title: prev.title, text: prev.text, author: prev.author, labels: prev.labels } } : null;

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: insets.top + space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingBottom: space.m }}>
        <Pressable accessibilityRole="button" accessibilityLabel={lx.cancel} onPress={navigation.goBack} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.bgRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Close />
        </Pressable>
        <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>
          {lx.shareTitle}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: 140, gap: space.m }}>
        {!url ? (
          <Text style={{ ...type.body, color: color.fgSecondary }}>{lx.noLink}</Text>
        ) : fake ? (
          <View style={{ gap: space.s }}>
            <LinkCard m={fake} p={fake.p as E.LinkPreview} mine={false} />
            <Text style={{ ...type.meta, color: color.trust }}>🔒 {lx.e2e}</Text>
          </View>
        ) : (
          <View style={{ height: 120, borderRadius: 16, backgroundColor: color.bgRaised, justifyContent: 'center', paddingHorizontal: space.l }}>
            <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.building}</Text>
          </View>
        )}
        <View style={{ gap: 6 }}>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.addMessage}</Text>
          <TextInput
            testID="share-msg"
            value={msg}
            onChangeText={setMsg}
            maxLength={500}
            accessibilityLabel={lx.addMessage}
            placeholderTextColor={color.fgMuted}
            style={{ height: 46, borderRadius: 14, borderWidth: 1, borderColor: color.line, backgroundColor: color.bgRaised, color: color.fgPrimary, paddingHorizontal: 14, fontFamily: font.regular, fontSize: 15 }}
          />
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={lx.search}
          accessibilityLabel={lx.search}
          placeholderTextColor={color.fgMuted}
          style={{ height: 44, borderRadius: 22, backgroundColor: color.bgRaised, color: color.fgPrimary, paddingHorizontal: 16, fontFamily: font.regular, fontSize: 15 }}
        />
        <Text style={{ ...type.caption, color: color.fgSecondary, letterSpacing: 0.6 }}>{lx.recent.toUpperCase()}</Text>
        {!shown.length ? <Text style={{ ...type.body, color: color.fgSecondary }}>{lx.noChats}</Text> : null}
        {shown.map((c) => {
          const ok = canShareTo(c);
          const on = sel.includes(c.id);
          return (
            <Pressable
              key={c.id}
              testID={`share-to-${c.id}`}
              disabled={!ok}
              onPress={() => toggle(c.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: !ok }}
              accessibilityLabel={`${c.name}${ok ? '' : ', ' + lx.waits}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, opacity: ok ? 1 : 0.45 }}
            >
              <Photo uri={c.photo} id={c.peer || c.id} label={c.name} style={{ width: 44, height: 44, borderRadius: 22 }} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ ...type.headline, color: color.fgPrimary }}>
                  {c.name}
                </Text>
                <Text numberOfLines={1} style={{ ...type.meta, color: color.fgSecondary }}>
                  {ok ? c.last : lx.waits}
                </Text>
              </View>
              <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? color.hookup : color.line, backgroundColor: on ? color.hookup : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Text style={{ color: color.onAccent, fontWeight: '800' }}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ position: 'absolute', left: space.l, right: space.l, bottom: insets.bottom + space.m, gap: 8, alignItems: 'center' }}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{lx.upTo5}</Text>
        <Pressable
          testID="share-send"
          accessibilityRole="button"
          disabled={!sel.length || !prev || busy}
          onPress={send}
          style={{ alignSelf: 'stretch', height: 56, borderRadius: 28, backgroundColor: sel.length && prev ? color.hookup : color.bgRaised, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ ...type.headline, fontSize: 17, color: sel.length && prev ? color.onAccent : color.fgMuted }}>{sel.length ? lx.sendTo(sel.length) : lx.pick}</Text>
        </Pressable>
      </View>
    </View>
  );
}

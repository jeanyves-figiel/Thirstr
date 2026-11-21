import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { trx } from '../i18n/translate';
import { TranslateMode } from '../me/prefs';
import { Marked } from './find';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon } from '../ui';
import { langName, plan, translateMessage, TrState } from './translate';

// S-41 incoming text bubble with on-device translation (F-07 R-07.28–R-07.29, #106).
// The bubble shows the translation; "Show original" expands it. A missing language pack or
// Tap mode shows a chip instead. Nothing here leaves the phone.
type Props = {
  cid: string;
  id: string;
  text: string;
  mode: TranslateMode;
  sender?: string | null;
  senderColor: string;
  reactions: string[];
  onLongPress?: () => void;
  /** F-19 G1: quoted message shown above the text. */
  quote?: React.ReactNode;
  onTranslated: (from: string) => void;
  /** R-07.39: search term to mark in the shown text. */
  mark?: string | null;
  /** R-07.39: current search match. */
  ring?: boolean;
};

export function TranslatedText({ cid, id, text, mode, sender, senderColor, reactions, onLongPress, onTranslated, mark, ring, quote }: Props) {
  const [st, setSt] = useState<TrState>({ kind: 'none' });
  const [orig, setOrig] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    plan(cid, id, text, mode)
      .then((s) => live && setSt(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cid, id, text, mode]);

  useEffect(() => {
    if (st.kind === 'done') onTranslated(st.tr.from);
  }, [st, onTranslated]);

  const run = async (from: string, download: boolean) => {
    setBusy(true);
    try {
      const tr = await translateMessage(cid, id, text, from, download);
      setSt(tr ? { kind: 'done', tr } : { kind: 'none' });
    } catch {
      /* declined the download or failed: keep the original */
    } finally {
      setBusy(false);
    }
  };

  const done = st.kind === 'done' ? st.tr : null;
  return (
    <View style={{ alignItems: 'flex-start', gap: 4 }}>
      <Pressable
        testID={ring ? 'find-current' : `msg-${id}`}
        onLongPress={onLongPress}
        onPress={done ? () => setOrig((v) => !v) : undefined}
        accessibilityHint={done ? (orig ? trx.hideOriginal : trx.showOriginal) : undefined}
        style={{ maxWidth: '80%', paddingHorizontal: space.m, paddingVertical: 10, borderRadius: 20, borderBottomLeftRadius: 6, backgroundColor: color.bgRaised, gap: 2, borderWidth: ring ? 2 : 0, borderColor: color.personal }}
      >
        {sender ? <Text style={{ ...type.caption, color: senderColor }}>{sender}</Text> : null}
        {quote}
        {mark && !done ? (
          <Marked style={{ ...type.body, color: color.fgPrimary }} text={text} q={mark} />
        ) : (
          <Text testID={done ? `tr-${id}` : undefined} style={{ ...type.body, color: color.fgPrimary }} selectable>
            {done ? done.text : text}
          </Text>
        )}
        {done && orig ? (
          <>
            <View style={{ height: 1, backgroundColor: color.line, marginVertical: 6 }} />
            <Text testID={`orig-${id}`} style={{ fontSize: 14, lineHeight: 20, fontFamily: font.regular, color: color.fgSecondary }} selectable>
              {text}
            </Text>
          </>
        ) : null}
      </Pressable>
      {reactions.length ? <Text style={{ ...type.meta, marginTop: -6 }}>{reactions.join('')}</Text> : null}
      {done ? (
        <Pressable accessibilityRole="button" onPress={() => setOrig((v) => !v)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 6, minHeight: 20 }}>
          <Icon.Translate />
          <Text style={{ ...type.caption, fontFamily: font.bold, color: color.fgMuted }}>
            {orig ? langName(done.from) : trx.from(langName(done.from))} · <Text style={{ color: color.trust, fontFamily: font.heavy }}>{orig ? trx.hideOriginal : trx.showOriginal}</Text>
          </Text>
        </Pressable>
      ) : null}
      {st.kind === 'offer' ? (
        <View style={{ gap: 6 }}>
          <Pressable
            testID={`tr-offer-${id}`}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => run(st.from, st.download)}
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: st.download ? 36 : 32,
              paddingLeft: 10,
              paddingRight: 14,
              borderRadius: radius.pill,
              borderWidth: st.download ? 1 : 0,
              borderColor: `${color.trust}80`,
              backgroundColor: st.download ? `${color.trust}1F` : color.bgRaised,
            }}
          >
            <Icon.Translate size={st.download ? 16 : 14} />
            <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.trust }}>
              {busy ? trx.translating : st.download ? trx.translateLang(langName(st.from)) : trx.translate}
            </Text>
          </Pressable>
          {st.download ? <Text style={{ ...type.caption, fontFamily: font.bold, color: color.fgMuted, paddingLeft: 6, maxWidth: 250 }}>{trx.download}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

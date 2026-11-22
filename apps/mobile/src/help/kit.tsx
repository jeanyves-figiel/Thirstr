import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../api/client';
import { helpLang, hx } from '../i18n/help';
import { color, font, radius, space, type } from '../theme/tokens';
import { ARTICLES, CAT_NAMES, CATS, META, type Block, type CatId, type Lang, type Meta, type Text as Art } from './articles';

// F-22 (#178): shared help-center pieces (S-80/S-81), used signed in (stack screens) and signed out (S-84).

export const lang: Lang = helpLang;
export const catName = (c: CatId) => CAT_NAMES[lang][c];
export const toneOf = (c: CatId) => color[CATS.find((x) => x.id === c)?.tone ?? 'trust'];
export const metaOf = (id: string): Meta | undefined => META.find((m) => m.id === id);
/** Article text in the phone's language, English as a fallback (flagged in the UI). */
export function article(id: string): { t: Art; en: boolean } | null {
  const t = ARTICLES[lang][id];
  if (t) return { t, en: false };
  const e = ARTICLES.en[id];
  return e ? { t: e, en: lang !== 'en' } : null;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** R-22.3: offline search over titles, summaries, keywords and body text; titles rank first. */
export function search(q: string): Meta[] {
  const t = fold(q.trim());
  if (t.length < 2) return [];
  const words = t.split(/\s+/);
  const scored = META.map((m) => {
    const a = article(m.id)?.t;
    if (!a) return [m, 0] as const;
    const title = fold(a.title);
    const rest = fold([a.sum, m.keywords ?? '', ...a.body.map(blockText)].join(' '));
    let s = 0;
    for (const w of words) {
      if (title.includes(w)) s += 3;
      else if (rest.includes(w)) s += 1;
      else return [m, 0] as const;
    }
    return [m, s] as const;
  });
  return scored
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([m]) => m);
}

function blockText(b: Block): string {
  if ('p' in b) return b.p;
  if ('h' in b) return b.h;
  if ('ol' in b) return b.ol.join(' ');
  if ('ul' in b) return b.ul.join(' ');
  return b.go;
}

export function SearchBox({ value, onChange, testID }: { value: string; onChange: (s: string) => void; testID?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: color.bgRaised }}>
      <TextInput testID={testID} accessibilityLabel={hx.search} placeholder={hx.search} placeholderTextColor={color.fgMuted} value={value} onChangeText={onChange} returnKeyType="search" style={{ flex: 1, ...type.body, color: color.fgPrimary, height: 46 }} />
    </View>
  );
}

export function ArticleRow({ m, onPress }: { m: Meta; onPress: () => void }) {
  const a = article(m.id);
  if (!a) return null;
  return (
    <Pressable testID={`help-a-${m.id}`} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingHorizontal: space.l, paddingVertical: space.s, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: toneOf(m.cat) }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, fontFamily: font.medium, color: color.fgPrimary }}>{a.t.title}</Text>
        <Text numberOfLines={1} style={{ ...type.meta, color: color.fgMuted }}>
          {a.t.sum}
        </Text>
      </View>
      <Text style={{ ...type.headline, color: color.fgMuted }}>›</Text>
    </Pressable>
  );
}

export function Card({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden', borderLeftWidth: tone ? 3 : 0, borderLeftColor: tone }}>
      {kids.map((c, i) => (
        <View key={i} style={i ? { borderTopWidth: 1, borderTopColor: color.lineSubtle } : null}>
          {c}
        </View>
      ))}
    </View>
  );
}

export const Cap = ({ children, tone }: { children: React.ReactNode; tone?: string }) => <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: tone ?? color.fgMuted, marginHorizontal: space.xs }}>{children}</Text>;

/** S-81 body. `onGo` is left out signed out (S-84), where app screens can't open. */
export function ArticleBody({ id, onGo, onOpen }: { id: string; onGo?: (route: string, params?: object) => void; onOpen: (id: string) => void }) {
  const a = article(id);
  const m = metaOf(id);
  if (!a || !m) return null;
  return (
    <View style={{ gap: space.l }}>
      <View style={{ gap: space.s }}>
        <Text style={{ ...type.caption, letterSpacing: 1, textTransform: 'uppercase', color: toneOf(m.cat) }}>{catName(m.cat)}</Text>
        <Text accessibilityRole="header" style={{ ...type.display, fontSize: 28, lineHeight: 34, color: color.fgPrimary }}>
          {a.t.title}
        </Text>
        <Text style={{ ...type.meta, color: color.fgMuted }}>
          {hx.updated(m.updated)}
          {a.en ? ` · ${hx.englishOnly}` : ''}
        </Text>
      </View>
      {a.t.body.map((b, i) => (
        <BlockView key={i} b={b} onGo={onGo} tone={toneOf(m.cat)} />
      ))}
      <Vote id={id} />
      {m.related.length ? (
        <View style={{ gap: space.s }}>
          <Cap>{hx.related}</Cap>
          <Card>
            {m.related.map((r) => {
              const rm = metaOf(r);
              return rm ? <ArticleRow key={r} m={rm} onPress={() => onOpen(r)} /> : null;
            })}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function BlockView({ b, onGo, tone }: { b: Block; onGo?: (route: string, params?: object) => void; tone: string }) {
  const body = { ...type.body, fontSize: 16, lineHeight: 24, color: color.fgSoft };
  if ('p' in b) return <Text style={body}>{b.p}</Text>;
  if ('h' in b) return <Text style={{ ...type.headline, fontSize: 18, color: color.fgPrimary, marginTop: space.s }}>{b.h}</Text>;
  if ('ol' in b || 'ul' in b) {
    const items = 'ol' in b ? b.ol : b.ul;
    return (
      <View style={{ gap: space.s }}>
        {items.map((x, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: space.m }}>
            <Text style={{ ...body, fontFamily: font.heavy, color: tone, minWidth: 18 }}>{'ol' in b ? `${i + 1}.` : '•'}</Text>
            <Text style={{ ...body, flex: 1 }}>{x}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (!onGo) return null;
  return (
    <Pressable testID={`help-go-${b.route}`} accessibilityRole="button" onPress={() => onGo(b.route, b.params)} style={({ pressed }) => ({ alignSelf: 'flex-start', paddingHorizontal: space.l, height: 44, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: tone, opacity: pressed ? 0.8 : 1 })}>
      <Text style={{ ...type.headline, color: color.onAccent }}>{b.go} →</Text>
    </Pressable>
  );
}

/** R-22.5: 👍/👎 counted per day on the server, no account, no device id; 👎 asks why (optional note, scrubbed). */
function Vote({ id }: { id: string }) {
  const [st, setSt] = useState<'ask' | 'why' | 'done'>('ask');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const send = (helpful: boolean, r?: string | null, n?: string) => {
    setSt('done');
    api('POST', '/help/votes', { article: id, lang, helpful, reason: r ?? undefined, note: n?.trim() || undefined }).catch(() => {});
  };
  const pill = (label: string, on: boolean, onPress: () => void, testID?: string) => (
    <Pressable key={label} testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={{ paddingHorizontal: space.l, height: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: on ? color.bgInverse : color.bgOverlay }}>
      <Text style={{ ...type.meta, fontFamily: font.bold, color: on ? color.onAccent : color.fgPrimary }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: space.m, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised }}>
      {st === 'done' ? (
        <Text style={{ ...type.body, color: color.trust }}>{hx.thanks}</Text>
      ) : (
        <>
          <Text style={{ ...type.headline, color: color.fgPrimary }}>{hx.helpful}</Text>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            {pill(`👍 ${hx.yes}`, false, () => send(true), 'help-yes')}
            {pill(`👎 ${hx.no}`, st === 'why', () => setSt('why'), 'help-no')}
          </View>
          {st === 'why' ? (
            <View style={{ gap: space.m }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>{Object.entries(hx.reasons).map(([k, l]) => pill(l, reason === k, () => setReason(k)))}</View>
              <TextInput value={note} onChangeText={setNote} maxLength={300} placeholder={hx.notePh} placeholderTextColor={color.fgMuted} multiline style={{ ...type.body, color: color.fgPrimary, minHeight: 64, padding: space.m, borderRadius: radius.sm, backgroundColor: color.bgOverlay, textAlignVertical: 'top' }} />
              {pill(hx.send, true, () => send(false, reason, note), 'help-no-send')}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

export const hm = (iso: string | null | undefined, now: number) => {
  const ms = iso ? Math.max(0, new Date(iso).getTime() - now) : 0;
  const m = Math.ceil(ms / 60000);
  return hx.h(Math.floor(m / 60), m % 60);
};

// S-84 "Someone else got in": the claim starts after the next sign-in, which may come back through an email link.
const INTENT = 'thirstr.claimIntent';
export const setClaimIntent = async (on: boolean) => {
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await (on ? AS.setItem(INTENT, String(Date.now())) : AS.removeItem(INTENT)).catch(() => {});
};
/** True once if a claim was asked for in the last hour. */
export const takeClaimIntent = async () => {
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  const v = await AS.getItem(INTENT).catch(() => null);
  if (v) await AS.removeItem(INTENT).catch(() => {});
  return !!v && Date.now() - Number(v) < 3600e3;
};

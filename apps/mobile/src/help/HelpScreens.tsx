import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../api/client';
import { useSession } from '../app/session';
import { hx } from '../i18n/help';
import { color, font, radius, space, type } from '../theme/tokens';
import { CATS, META, type CatId } from './articles';
import { ArticleBody, ArticleRow, Cap, Card, catName, SearchBox, search, toneOf } from './kit';

type Nav = { navigate: (s: string, p?: object) => void; push?: (s: string, p?: object) => void };
type R<P> = { navigation: Nav; route: { params?: P } };

const TOP = ['lost-phone', 'hide-distance', 'go-hidden', 'report-someone', 'selfie-fails'];

const scroll = { style: { flex: 1, backgroundColor: color.bgBase }, contentContainerStyle: { padding: space.l, paddingTop: space.s, gap: space.xxl, paddingBottom: 120, maxWidth: 560, width: '100%' as const, alignSelf: 'center' as const } };

function Title({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 40, color: color.fgPrimary }}>
      {children}
    </Text>
  );
}

function Action({ title, sub, onPress, tone, testID, badge }: { title: string; sub?: string; onPress: () => void; tone: string; testID?: string; badge?: number }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingHorizontal: space.l, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.body, fontFamily: font.medium, fontSize: 16, color: color.fgPrimary }}>{title}</Text>
        {sub ? <Text style={{ ...type.meta, color: color.fgMuted }}>{sub}</Text> : null}
      </View>
      {badge ? (
        <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ ...type.caption, color: color.onAccent }}>{badge}</Text>
        </View>
      ) : null}
      <Text style={{ ...type.headline, color: color.fgMuted }}>›</Text>
    </Pressable>
  );
}

/** S-80 Help home: search, "ways back in" (R-22.6), top answers, topics, contact / requests / feedback. */
export function HelpHomeScreen({ navigation }: R<undefined>) {
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [phrase, setPhrase] = useState<boolean | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api<{ on: boolean }>('GET', '/me/recovery').then((r) => setPhrase(r.on), () => setPhrase(null));
    api<{ requests: { unread: boolean }[] }>('GET', '/support/requests').then((r) => setUnread(r.requests.filter((x) => x.unread).length), () => {});
  }, []);
  const hits = useMemo(() => (q.trim().length >= 2 ? search(q) : null), [q]);
  const open = (id: string) => navigation.navigate('HelpArticle', { id });

  const ways = [
    { k: 'signin', on: !!(me.has_email || me.has_oidc), label: hx.ways.signin, fix: () => navigation.navigate('AccountSettings'), cta: hx.ways.setUp },
    { k: 'phrase', on: !!phrase, label: hx.ways.phrase, fix: () => navigation.navigate('Recovery'), cta: hx.ways.setUp },
    { k: 'selfie', on: me.verified, label: hx.ways.selfie, fix: () => navigation.navigate('Verify'), cta: hx.ways.verify },
  ];
  const n = ways.filter((w) => w.on).length;

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" {...scroll}>
      <Title>{hx.title}</Title>
      <View style={{ marginTop: -space.s }}>
        <SearchBox testID="help-search" value={q} onChange={setQ} />
      </View>
      {hits ? (
        hits.length ? (
          <Card>
            {hits.map((m) => (
              <ArticleRow key={m.id} m={m} onPress={() => open(m.id)} />
            ))}
          </Card>
        ) : (
          <Text style={{ ...type.body, color: color.fgMuted }}>{hx.noResult(q.trim())}</Text>
        )
      ) : (
        <>
          {phrase !== null && n < 3 ? (
            <View testID="help-ways" style={{ gap: space.m, padding: space.l, borderRadius: radius.md, backgroundColor: color.trustTint, borderWidth: 1, borderColor: color.trust }}>
              <Text style={{ ...type.headline, fontSize: 18, color: color.fgPrimary }}>{hx.ways.title(n)}</Text>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{hx.ways.sub}</Text>
              {ways.map((w) => (
                <View key={w.k} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 36 }}>
                  <Text style={{ ...type.headline, color: w.on ? color.trust : color.fgMuted, width: 18 }}>{w.on ? '✓' : '○'}</Text>
                  <Text style={{ flex: 1, ...type.body, color: w.on ? color.fgPrimary : color.fgSecondary }}>{w.label}</Text>
                  {!w.on ? (
                    <Pressable accessibilityRole="button" onPress={w.fix} style={{ paddingHorizontal: space.m, height: 32, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: color.trust }}>
                      <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{w.cta}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ gap: space.s }}>
            <Cap>{hx.top}</Cap>
            <Card>
              {TOP.map((id) => {
                const m = META.find((x) => x.id === id);
                return m ? <ArticleRow key={id} m={m} onPress={() => open(id)} /> : null;
              })}
            </Card>
          </View>
          <View style={{ gap: space.s }}>
            <Cap>{hx.topics}</Cap>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {CATS.map((c) => (
                <Pressable key={c.id} testID={`help-cat-${c.id}`} accessibilityRole="button" onPress={() => navigation.navigate('HelpCategory', { cat: c.id })} style={({ pressed }) => ({ width: '48.5%', minHeight: 84, padding: space.m, gap: space.xs, borderRadius: radius.md, backgroundColor: color.bgRaised, borderTopWidth: 3, borderTopColor: toneOf(c.id), opacity: pressed ? 0.75 : 1 })}>
                  <Text style={{ ...type.headline, color: color.fgPrimary }}>{catName(c.id)}</Text>
                  <Text style={{ ...type.meta, color: color.fgMuted }}>{hx.articles(META.filter((m) => m.cat === c.id).length)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={{ gap: space.s }}>
            <Cap>{hx.stuck}</Cap>
            <Card>
              <Action testID="help-contact" title={hx.contact} tone={color.hookup} onPress={() => navigation.navigate('HelpContact')} />
              <Action testID="help-requests" title={hx.requests} tone={color.trust} badge={unread} onPress={() => navigation.navigate('HelpRequests')} />
              <Action testID="help-feedback" title={hx.feedback} tone={color.friends} onPress={() => navigation.navigate('HelpFeedback')} />
            </Card>
            <Text style={{ ...type.meta, color: color.trust, marginHorizontal: space.xs }}>🔒 {hx.never}</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

export function HelpCategoryScreen({ navigation, route }: R<{ cat: CatId }>) {
  const cat = route.params?.cat ?? 'start';
  return (
    <ScrollView showsVerticalScrollIndicator={false} {...scroll}>
      <Title>{catName(cat)}</Title>
      <Card tone={toneOf(cat)}>
        {META.filter((m) => m.cat === cat).map((m) => (
          <ArticleRow key={m.id} m={m} onPress={() => navigation.navigate('HelpArticle', { id: m.id })} />
        ))}
      </Card>
    </ScrollView>
  );
}

/** S-81 article. Related links push a new article so Back returns to the one before. */
export function HelpArticleScreen({ navigation, route }: R<{ id: string }>) {
  const id = route.params?.id ?? '';
  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets {...scroll}>
      <ArticleBody id={id} onGo={(r, p) => navigation.navigate(r, p)} onOpen={(next) => (navigation.push ?? navigation.navigate)('HelpArticle', { id: next })} />
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('HelpContact')} style={{ alignSelf: 'center', padding: space.m }}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          {hx.stuck} <Text style={{ color: color.hookup, fontFamily: font.heavy }}>{hx.contact}</Text>
        </Text>
      </Pressable>
    </ScrollView>
  );
}

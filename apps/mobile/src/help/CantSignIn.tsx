import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { hx } from '../i18n/help';
import { StepShell } from '../onboarding/kit';
import { color, font, radius, space, type } from '../theme/tokens';
import { ArticleBody, ArticleRow, Cap, Card, metaOf } from './kit';
import { ContactForm, ContactSent } from './SupportScreens';

// S-84 Can't sign in (R-22.20–R-22.22, #178): the recovery ladder, fastest first. Support can't move accounts.

type Rung = 'phone' | 'words' | 'method' | 'claim';
const TONE: Record<Rung, string> = { phone: color.sport, words: color.personal, method: color.trust, claim: color.hookup };
const ARTS = ['lost-phone', 'someone-got-in', 'new-phone', 'recovery-words'];

export function CantSignInScreen({ onBack, onLink, onWords, onSignIn }: { onBack: () => void; onLink: () => void; onWords: () => void; onSignIn: (claim: boolean) => void }) {
  const [view, setView] = useState<{ k: 'ladder' } | { k: 'article'; id: string; from?: string } | { k: 'contact' } | { k: 'sent'; ref: string; topic: string }>({ k: 'ladder' });

  if (view.k === 'article') {
    return (
      <StepShell title="" onBack={() => setView(view.from ? { k: 'article', id: view.from } : { k: 'ladder' })} scroll>
        <ArticleBody id={view.id} onOpen={(id) => setView({ k: 'article', id, from: view.id })} />
      </StepShell>
    );
  }
  if (view.k === 'contact') {
    return (
      <StepShell title={hx.contact} sub={hx.supportCant} onBack={() => setView({ k: 'ladder' })} scroll>
        <ContactForm signedOut initialTopic="account" onDone={(ref, topic) => setView({ k: 'sent', ref, topic })} />
      </StepShell>
    );
  }
  if (view.k === 'sent') {
    return (
      <StepShell title="" onBack={onBack} scroll>
        <ContactSent refCode={view.ref} topic={view.topic} email onDone={onBack} />
      </StepShell>
    );
  }

  const go: Record<Rung, () => void> = { phone: onLink, words: onWords, method: () => onSignIn(false), claim: () => onSignIn(true) };
  return (
    <StepShell title={hx.backIn} sub={hx.fastest} onBack={onBack} scroll>
      <View style={{ gap: space.s }}>
        {(Object.keys(hx.ladder) as Rung[]).map((k, i) => {
          const [title, sub] = hx.ladder[k];
          return (
            <Pressable key={k} testID={`cant-${k}`} accessibilityRole="button" onPress={go[k]} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l, borderRadius: radius.md, backgroundColor: color.bgRaised, borderLeftWidth: 3, borderLeftColor: TONE[k], opacity: pressed ? 0.75 : 1 })}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: TONE[k], alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: font.heavy, color: color.onAccent }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.headline, color: color.fgPrimary }}>{title}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text>
              </View>
              <Text style={{ ...type.headline, color: color.fgMuted }}>›</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ padding: space.l, gap: space.xs, borderRadius: radius.md, backgroundColor: color.trustTint }}>
        <Text style={{ ...type.headline, color: color.trust }}>🔒 {hx.supportCant}</Text>
        <Text style={{ ...type.meta, color: color.fgSoft }}>{hx.never}</Text>
      </View>
      <View style={{ gap: space.s }}>
        <Cap>{hx.helpArticles}</Cap>
        <Card>
          {ARTS.map((id) => {
            const m = metaOf(id);
            return m ? <ArticleRow key={id} m={m} onPress={() => setView({ k: 'article', id })} /> : null;
          })}
        </Card>
      </View>
      <Pressable testID="cant-contact" accessibilityRole="button" onPress={() => setView({ k: 'contact' })} style={{ alignSelf: 'center', padding: space.m }}>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>
          {hx.stuck} <Text style={{ color: color.hookup, fontFamily: font.heavy }}>{hx.contact}</Text>
        </Text>
      </Pressable>
    </StepShell>
  );
}

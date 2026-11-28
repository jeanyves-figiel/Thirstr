// F-25 Refill screens (#339, D-26, mockup https://claude.ai/artifact/1GXbFpJ6qzD6Ko74get3AY).
// Sunflower (`personal`) = private to you; coral only for the mutual moment.
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../app/session';
import * as E from '../chat/engine';
import * as P from '../chat/people';
import { tx } from '../i18n/app';
import { rfx } from '../i18n/refill';
import { Group, Page, Row, SegBlock, SwitchRow, useSettings } from '../me/settings/parts';
import { isPlus } from '../plus/plus';
import { SheetFrame } from '../safety/live';
import { color, font, radius, space, type } from '../theme/tokens';
import { SafetySheet, SheetRow } from '../trust/SafetySheet';
import { EmptyState, Icon, Photo, Segmented, Sheet } from '../ui';
import { toast } from '../ui/Toast';
import * as Feed from './feed';
import * as R from './refill';

type Nav = { navigate: (s: string, p?: object) => void; goBack: () => void };

const pill = (bg: string) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, alignSelf: 'flex-start' as const, gap: 5, height: 22, paddingHorizontal: 9, borderRadius: radius.pill, backgroundColor: bg });
const chipText = { ...type.caption, fontSize: 11, color: color.onAccent };
const btn = (bg: string, border?: string) => ({ flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: space.m, backgroundColor: bg, borderWidth: border ? 1.5 : 0, borderColor: border });
const btnText = (c: string) => ({ ...type.meta, fontFamily: font.heavy, fontSize: 14, color: c });
const day = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

// ------------------------------------------------------------------ Chats card (S-40, R-25.5)

/** Top of Chats › All: one private card (intro, someone back, or my sealed yes). */
export function RefillCard({ navigation }: { navigation: Pick<Nav, 'navigate'> }) {
  R.useRefill();
  const { me, setMe } = useSession();
  const [more, setMore] = useState(false);
  const card = R.currentCard();
  const [now] = useState(Date.now);
  if (!card || now - card.at >= R.CARD_TTL) return null;
  const plus = isPlus(me);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;

  if (card.kind === 'intro') {
    if (safe) return null;
    const answer = (show: boolean | null, findMe: boolean) =>
      Feed.setSwitches(me, plus ? show : false, findMe).then(
        (s) => setMe({ ...me, settings: { ...me.settings!, ...s } }),
        () => toast(tx.common.error),
      );
    return (
      <View testID="refill-intro" style={box}>
        <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: color.personal, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.Refill size={24} c={color.onAccent} w={2.3} />
          </View>
          <Text style={{ ...type.headline, color: color.fgPrimary, flex: 1 }}>{plus ? rfx.introTitle : rfx.name}</Text>
        </View>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{plus ? rfx.introBody : rfx.introFree}</Text>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Pressable testID="refill-intro-no" accessibilityRole="button" onPress={() => answer(false, false)} style={btn(color.bgOverlay)}>
            <Text style={btnText(color.fgPrimary)}>{rfx.introNo}</Text>
          </Pressable>
          <Pressable testID="refill-intro-yes" accessibilityRole="button" onPress={() => answer(true, true)} style={btn(color.personal)}>
            <Text style={btnText(color.onAccent)}>{plus ? rfx.introOn : rfx.introYes}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Person cards are Plus (D-26) and never in Safe Mode.
  if (!plus || safe) return null;
  const c = E.convWith(card.peer);
  const sealed = R.sealed(card.peer, now);
  const first = card.name.split(',')[0];
  const seal = (on: boolean) => {
    if (!c) return;
    E.sendRefill(c.id, on).then(
      () => toast(on ? rfx.sealedToast(first) : rfx.unsealedToast),
      () => toast(tx.common.error),
    );
  };
  const write = () => {
    R.dismissCard(false);
    navigation.navigate('Chat', c ? { cid: c.id } : { profileId: card.peer, name: card.name });
  };
  return (
    <View testID="refill-card" style={box}>
      <View style={{ flexDirection: 'row', gap: space.m, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={card.name} onPress={() => navigation.navigate('Profile', { id: card.peer })} style={{ width: 54, height: 54, borderRadius: 27, borderWidth: 2.5, borderColor: color.personal, padding: 2.5 }}>
          <Photo uri={card.photo} id={card.peer} label="" style={{ width: 44, height: 44, borderRadius: 22 }} />
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>
            {sealed ? rfx.sealedTitle : card.trigger === 'place' ? rfx.why.place(first, card.where) : rfx.why[card.trigger](first)}
          </Text>
          <View style={pill(color.personal)}>
            {sealed ? <Icon.Check size={11} c={color.onAccent} w={3} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.onAccent }} />}
            <Text style={chipText}>{sealed ? rfx.sealedChip : rfx.chip[card.trigger]}</Text>
          </View>
        </View>
      </View>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{sealed ? rfx.sealedSub(first) : rfx.cardSub}</Text>
      {sealed ? (
        <>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Pressable testID="refill-unseal" accessibilityRole="button" onPress={() => seal(false)} style={btn('transparent', color.line)}>
              <Text style={btnText(color.fgSecondary)}>{rfx.takeBack}</Text>
            </Pressable>
            <Pressable testID="refill-write" accessibilityRole="button" onPress={write} style={btn(color.bgInverse)}>
              <Text style={btnText(color.onAccent)}>{rfx.write}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
            <Icon.Lock size={12} c={color.trust} w={2.6} />
            <Text style={{ ...type.caption, fontSize: 11.5, color: color.trust, flex: 1, fontFamily: font.medium }}>{rfx.lock}</Text>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Pressable testID="refill-yes" accessibilityRole="button" onPress={() => (c ? seal(true) : write())} style={btn(color.personal)}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={btnText(color.onAccent)}>{c ? rfx.up : rfx.write}</Text>
          </Pressable>
          <Pressable testID="refill-later" accessibilityRole="button" onPress={() => R.dismissCard(true)} style={btn(color.bgOverlay)}>
            <Text style={btnText(color.fgPrimary)}>{rfx.notNow}</Text>
          </Pressable>
          <Pressable testID="refill-more" accessibilityRole="button" accessibilityLabel={rfx.more} onPress={() => setMore(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color.bgOverlay, alignItems: 'center', justifyContent: 'center' }}>
            <Icon.More size={18} />
          </Pressable>
        </View>
      )}
      <Sheet visible={more} onClose={() => setMore(false)} title={rfx.name} closeLabel={tx.common.close}>
        <SheetRow
          testID="refill-mute"
          title={rfx.notHim}
          onPress={() => {
            setMore(false);
            R.mute(card.peer).then(() => toast(rfx.notHimDone(first)));
          }}
        />
        <SheetRow
          title={rfx.snooze}
          onPress={() => {
            setMore(false);
            R.setPrefs({ snoozeUntil: Date.now() + 7 * R.DAY }).then(() => R.dismissCard(false));
          }}
        />
        <SheetRow
          last
          title={rfx.settings}
          onPress={() => {
            setMore(false);
            navigation.navigate('RefillSettings');
          }}
        />
      </Sheet>
    </View>
  );
}

const box = {
  marginHorizontal: space.l,
  marginBottom: space.m,
  padding: space.m + 2,
  gap: space.m,
  borderRadius: radius.md,
  borderWidth: 1.5,
  borderColor: 'rgba(255,201,60,0.6)',
  backgroundColor: 'rgba(255,201,60,0.09)',
};

// ------------------------------------------------------------------ chat row (local only)

export function MatchRow() {
  return (
    <View testID="refill-match-row" accessibilityLabel={rfx.matchRow} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: color.hookup, marginVertical: space.s }}>
      <Icon.Refill size={14} c={color.onAccent} w={2.6} />
      <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.onAccent }}>{rfx.matchRow}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ match screen (A)

export function RefillMatchScreen({ navigation, route }: { navigation: Nav; route: { params: { peer: string; name: string; photo: string | null } } }) {
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const { peer, name, photo } = route.params;
  const first = name.split(',')[0];
  const mine = me.profile?.photos.find((x) => x.slot === 0);
  const c = E.convWith(peer);
  return (
    <View testID="refill-match" style={{ flex: 1, backgroundColor: color.bgBase, alignItems: 'center', justifyContent: 'center', padding: space.xxl, paddingBottom: insets.bottom + space.xxl, gap: space.l }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: '12%', width: 420, height: 420, borderRadius: 210, backgroundColor: color.hookup, opacity: 0.22 }} />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: color.hookup, padding: 3, backgroundColor: color.bgBase }}>
          <Photo uri={mine?.thumb_url ?? mine?.url ?? null} id={me.profile?.id ?? 'me'} label="" style={{ width: 84, height: 84, borderRadius: 42 }} />
        </View>
        <View style={{ width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: color.hookup, padding: 3, marginLeft: -20, backgroundColor: color.bgBase }}>
          <Photo uri={photo} id={peer} label={name} style={{ width: 84, height: 84, borderRadius: 42 }} />
        </View>
      </View>
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 30, lineHeight: 34, color: color.fgPrimary, textAlign: 'center' }}>{rfx.matchTitle}</Text>
      <Text style={{ ...type.body, color: color.fgSecondary, textAlign: 'center' }}>{rfx.matchSub(first)}</Text>
      <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
        <Pressable
          testID="refill-say-hi"
          accessibilityRole="button"
          onPress={() => {
            navigation.goBack();
            navigation.navigate('Chat', c ? { cid: c.id } : { profileId: peer, name });
          }}
          style={{ height: 52, borderRadius: radius.pill, backgroundColor: color.hookup, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={btnText(color.onAccent)}>{rfx.sayHi}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={{ height: 48, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={btnText(color.fgSecondary)}>{rfx.later}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ after the date (C)

export function RefillAskScreen({ navigation, route }: { navigation: Nav; route: { params: { peer: string; name?: string } } }) {
  R.useRefill();
  const { peer } = route.params;
  const c = E.convWith(peer);
  const name = (c?.name ?? route.params.name ?? R.rec(peer)?.name ?? '…').split(',')[0];
  const [rating, setRating] = useState<R.Rating | null>(R.rec(peer)?.rating ?? null);
  const [note, setNote] = useState(P.noteFor(peer)?.text ?? '');
  const [seal, setSeal] = useState(!!c);
  const [safety, setSafety] = useState(false);
  const opts: { k: R.Rating; glyph: React.ReactNode }[] = [
    { k: 'yes', glyph: <Icon.Flame size={20} c={color.hookup} fill={color.hookup} /> },
    { k: 'maybe', glyph: <Icon.Timer size={20} c={color.personal} /> },
    { k: 'no', glyph: <Icon.Close size={20} c={color.fgSecondary} /> },
  ];
  const save = async () => {
    await R.rate(peer, rating);
    const n = P.noteFor(peer);
    if ((n?.text ?? '') !== note.trim()) await P.setNote(peer, { text: note, tags: n?.tags ?? [] });
    if (rating === 'yes' && seal && c && !R.sealed(peer)) await E.sendRefill(c.id, true).catch(() => {});
    navigation.goBack();
  };
  return (
    <SheetFrame onClose={() => navigation.goBack()} testID="refill-ask">
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={{ ...type.title, color: color.fgPrimary }}>{rfx.askTitle(name)}</Text>
        <Text style={{ ...type.meta, color: color.fgSecondary }}>{rfx.askSub(name)}</Text>
      </View>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: space.s }}>
        {opts.map((o) => {
          const on = rating === o.k;
          return (
            <Pressable
              key={o.k}
              testID={`refill-rate-${o.k}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={rfx.rate[o.k]}
              onPress={() => setRating(on ? null : o.k)}
              style={{ flex: 1, minHeight: 72, borderRadius: 18, borderWidth: 1.5, borderColor: on ? (o.k === 'no' ? color.fgSecondary : o.k === 'maybe' ? color.personal : color.hookup) : color.line, backgroundColor: on ? color.bgOverlay : color.bgBase, alignItems: 'center', justifyContent: 'center', gap: 4 }}
            >
              {o.glyph}
              <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgPrimary }}>{rfx.rate[o.k]}</Text>
            </Pressable>
          );
        })}
      </View>
      {rating === 'no' ? (
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{rfx.noSub}</Text>
          <Pressable testID="refill-hide-block" accessibilityRole="button" onPress={() => setSafety(true)} style={{ minHeight: 44, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.danger, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={btnText(color.danger)}>{rfx.hideBlock(name)}</Text>
          </Pressable>
        </View>
      ) : null}
      <TextInput
        testID="refill-note"
        value={note}
        onChangeText={(t) => setNote(t.slice(0, P.NOTE_MAX))}
        placeholder={rfx.notePh}
        placeholderTextColor={color.fgMuted}
        multiline
        accessibilityLabel={rfx.notePh}
        style={{ minHeight: 64, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.personal, padding: space.m, color: color.fgPrimary, fontFamily: font.regular, fontSize: 15, textAlignVertical: 'top' }}
      />
      {rating === 'yes' && c ? (
        <SwitchRow testID="refill-seal-too" title={rfx.sealToo(name)} sub={rfx.menuSealSub} value={seal} onChange={setSeal} tone={color.personal} />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={btn(color.bgOverlay)}>
          <Text style={btnText(color.fgPrimary)}>{rfx.skip}</Text>
        </Pressable>
        <Pressable testID="refill-save" accessibilityRole="button" onPress={() => save().catch(() => toast(tx.common.error))} style={btn(color.personal)}>
          <Text style={btnText(color.onAccent)}>{rfx.save}</Text>
        </Pressable>
      </View>
      <SafetySheet
        visible={safety}
        target={{ id: peer, name, age: c?.age }}
        onClose={() => setSafety(false)}
        onReport={(t) => {
          setSafety(false);
          navigation.navigate('Report', { profileId: t.id, cid: c?.id });
        }}
        onGone={() => R.rate(peer, 'no').then(() => navigation.goBack())}
      />
    </SheetFrame>
  );
}

// ------------------------------------------------------------------ Me › Refill (black book)

export function RefillBookScreen({ navigation }: { navigation: Nav }) {
  R.useRefill();
  const [tab, setTab] = useState<R.Rating>('yes');
  const [open, setOpen] = useState<string | null>(null);
  const rows = R.book(tab);
  const [now] = useState(Date.now);
  const status = (r: R.Rec) =>
    r.matched && now - r.matched < R.SEAL_TTL ? { t: rfx.st.matched, bg: color.hookup } : r.out && r.out > now ? { t: rfx.st.sealed, bg: color.personal } : null;
  const sel = open ? R.rec(open) : null;
  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: color.bgBase }} contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: 120 }}>
      <Text accessibilityRole="header" style={{ ...type.display, fontSize: 34, lineHeight: 38, color: color.fgPrimary }}>{rfx.bookTitle}</Text>
      <Segmented
        label={rfx.bookTitle}
        value={tab}
        onChange={setTab}
        grow
        options={(['yes', 'maybe', 'no'] as const).map((k) => ({ value: k, label: `${rfx.rate[k]} · ${R.book(k).length}` }))}
      />
      {rows.length ? (
        <View style={{ borderRadius: radius.md, backgroundColor: color.bgRaised, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const c = E.convWith(r.peer);
            const s = status(r);
            const n = P.noteFor(r.peer);
            return (
              <Pressable key={r.peer} testID={`refill-row-${r.peer}`} accessibilityRole="button" onPress={() => setOpen(r.peer)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderTopWidth: i ? 1 : 0, borderTopColor: color.lineSubtle, backgroundColor: pressed ? color.bgOverlay : 'transparent' })}>
                <Photo uri={c?.photo ?? r.photo ?? null} id={r.peer} label="" style={{ width: 44, height: 44, borderRadius: 22 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{(c?.name ?? r.name ?? '…').split(',')[0]}</Text>
                  <Text numberOfLines={1} style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>
                    {[r.met ? rfx.met(day(r.met)) : null, n?.text ? `“${n.text}”` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {s ? (
                  <View style={pill(s.bg)}>
                    <Text style={chipText}>{s.t}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState title={rfx.bookEmpty} body={rfx.bookEmptyBody} />
      )}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingHorizontal: space.xs }}>
        <Icon.Lock size={12} c={color.trust} w={2.6} />
        <Text style={{ ...type.meta, fontSize: 12, color: color.trust, flex: 1 }}>{rfx.kept}</Text>
      </View>
      <Sheet visible={!!sel} onClose={() => setOpen(null)} title={(sel?.name ?? '').split(',')[0]} closeLabel={tx.common.close}>
        {open ? (
          <>
            <SheetRow
              title={rfx.change}
              onPress={() => {
                const p = open;
                setOpen(null);
                navigation.navigate('RefillAsk', { peer: p });
              }}
            />
            <SheetRow
              title={rfx.write}
              onPress={() => {
                const p = open;
                const c = E.convWith(p);
                setOpen(null);
                navigation.navigate('Chat', c ? { cid: c.id } : { profileId: p, name: sel?.name ?? '' });
              }}
            />
            <SheetRow
              last
              danger
              title={rfx.forget}
              onPress={() => {
                const p = open;
                setOpen(null);
                R.forget(p).then(() => toast(rfx.forgetDone));
              }}
            />
          </>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ Settings › Privacy › Refill

export function RefillSettingsScreen() {
  R.useRefill();
  const { me } = useSession();
  const { st, put, err } = useSettings();
  const pf = R.prefs();
  const plus = isPlus(me);
  const safe = me.safe_mode === 'on' || !!me.safe_mode_active;
  const muted = R.mutedList();
  const [now] = useState(Date.now);
  const snoozed = !!pf.snoozeUntil && pf.snoozeUntil > now;
  if (!st) return <Page title={rfx.setTitle} loading />;
  return (
    <Page title={rfx.setTitle} err={err}>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{rfx.setLead}</Text>
      <Group hint={safe ? rfx.safeOff : plus ? undefined : rfx.plusOnly}>
        <SwitchRow testID="refill-show" title={rfx.show} sub={rfx.showSub} value={plus && !safe && pf.show === true} disabled={!plus || safe} onChange={(v) => R.setPrefs({ show: v })} tone={color.personal} />
        <SwitchRow testID="refill-find-me" title={rfx.findMe} sub={rfx.findMeSub} value={st.resurface_ok === true} disabled={safe} onChange={(v) => put({ resurface_ok: v })} />
      </Group>
      {plus ? (
        <Group label={rfx.when}>
          {R.TRIGGERS.map((t) => (
            <SwitchRow key={t} testID={`refill-trig-${t}`} title={rfx.trig[t]} value={pf.triggers[t]} disabled={pf.show !== true || safe} onChange={(v) => R.setPrefs({ triggers: { ...pf.triggers, [t]: v } })} tone={color.personal} />
          ))}
          <SegBlock
            testID="refill-snooze"
            title={rfx.snoozeFor}
            tone={color.personal}
            value={snoozed ? (pf.snoozeUntil! - now > 8 * R.DAY ? 'month' : 'week') : 'off'}
            options={(['off', 'week', 'month'] as const).map((k) => [k, rfx.snoozeOpts[k]])}
            onChange={(k) => R.setPrefs({ snoozeUntil: k === 'off' ? undefined : Date.now() + (k === 'week' ? 7 : 30) * R.DAY })}
            caption={snoozed ? rfx.snoozedUntil(day(pf.snoozeUntil!)) : undefined}
          />
        </Group>
      ) : null}
      <Group label={rfx.muted(muted.length)} hint={muted.length ? undefined : rfx.mutedEmpty}>
        {muted.map((m) => (
          <Row key={m.peer} title={(E.convWith(m.peer)?.name ?? m.name ?? '…').split(',')[0]} value={rfx.unmute} valueTone={color.personal} onPress={() => R.mute(m.peer, false)} />
        ))}
      </Group>
    </Page>
  );
}

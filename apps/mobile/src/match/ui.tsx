import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { Card } from '../api/types';
import { distanceLabel, opt, tx } from '../i18n/app';
import { interestLabel } from '../i18n/interests';
import { mt } from '../i18n/match';
import { PlusTag } from '../plus/PlusLimit';
import { color, font, modeColor, radius, space, type } from '../theme/tokens';
import { Button, Icon, Photo, Scrim, Sheet, VerifiedTick } from '../ui';
import { askHasFilters, type AskResult, type Refusal } from './ask';
import type { FitResult, Reason } from './fit';
import { speech } from './engine';
import { AGE_BANDS, type Learned } from './picks';
import { addRecent, useRecent } from './recent';

// F-24 Ask, Fit & Picks UI (#338, D-27, mockup https://claude.ai/artifact/UbsUPZs3DfVCDvw4NCfSPt).

const list = (xs: string[], label: (x: string) => string, max = 3) => {
  const shown = xs.slice(0, max).map(label);
  return xs.length > max ? `${shown.join(', ')} +${xs.length - max}` : shown.join(', ');
};
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ---------------------------------------------------------------- tile chip (R-24.13)

/** "Fit" (coral) when hookup wants line up, else "N ♥" (teal) for things in common. */
export function FitChip({ fit, online }: { fit: FitResult; online?: boolean }) {
  if (!fit.fit && fit.common < 1) return null;
  const bg = fit.fit ? color.hookup : color.trust;
  const label = fit.fit ? mt.fitChip : `${fit.common} ♥`;
  return (
    <View
      testID="fit-chip"
      accessible
      accessibilityLabel={fit.fit ? `${mt.fitA11y}${fit.common ? `, ${mt.inCommon(fit.common)}` : ''}` : mt.inCommon(fit.common)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 20, paddingHorizontal: 7, borderRadius: 10, backgroundColor: bg }}
    >
      {online ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color.sport, borderWidth: 1, borderColor: color.onAccent }} /> : null}
      <Text style={{ ...type.caption, fontSize: 10.5, lineHeight: 13, color: color.onAccent, fontVariant: ['tabular-nums'] }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- reasons (R-24.14, R-24.23)

type Line = { key: string; glyph: string; tint: string; strong: string; rest?: string };

function reasonLine(r: Reason): Line | null {
  switch (r.kind) {
    case 'position':
      return { key: 'pos', glyph: '⇄', tint: color.hookup, strong: mt.why.position(low(opt(r.mine, 'position')), low(opt(r.his, 'position'))) };
    case 'hosting':
      return { key: 'host', glyph: '⌂', tint: color.hookup, strong: mt.why.hosting(low(opt(r.mine, 'hosting')), low(opt(r.his, 'hosting'))) };
    case 'when':
      return { key: 'when', glyph: '◷', tint: color.hookup, strong: r.value === 'now' ? mt.why.now : mt.why.tonight };
    case 'interests':
      return { key: 'int', glyph: '♥', tint: color.trust, strong: mt.why.interests(r.items.length, list(r.items, (x) => low(interestLabel(x)))) };
    case 'sports':
      return { key: 'sport', glyph: '◆', tint: color.sport, strong: mt.why.sports(list(r.items, (x) => low(opt(x, 'sports'))), list(r.schedule, (x) => low(opt(x, 'schedule')), 2)) };
    case 'tribes':
      return { key: 'tribe', glyph: '●', tint: color.friends, strong: mt.why.tribes(list(r.items, (x) => low(opt(x, 'tribes')))) };
    case 'no_clash':
      return { key: 'ok', glyph: '✓', tint: color.fgMuted, strong: mt.why.noClash };
  }
}

export function traitLabel(t: Learned): string {
  switch (t.kind) {
    case 'age':
      return mt.trait.age(AGE_BANDS[t.band][0], AGE_BANDS[t.band][1]);
    case 'tribe':
      return low(opt(t.v, 'tribes'));
    case 'build':
      return low(opt(t.v, 'build'));
    case 'near':
      return mt.trait.near[t.v] ?? t.v;
    case 'online':
      return mt.trait.online;
  }
}

function Lines({ lines, small }: { lines: Line[]; small?: boolean }) {
  return (
    <View style={{ gap: small ? 6 : 8 }}>
      {lines.map((l) => (
        <View key={l.key} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
          <View style={{ width: small ? 20 : 22, height: small ? 20 : 22, borderRadius: 7, backgroundColor: l.tint, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: small ? 11 : 12, lineHeight: small ? 14 : 15, fontFamily: font.bold, color: color.onAccent }}>{l.glyph}</Text>
          </View>
          <Text style={{ ...type.body, fontSize: small ? 12.5 : 14, lineHeight: small ? 17 : 19, color: color.fgPrimary, flex: 1 }}>{l.strong}</Text>
        </View>
      ))}
    </View>
  );
}

const fitLines = (fit: FitResult) => fit.reasons.map(reasonLine).filter((l): l is Line => !!l);

/** S-20 "Why you fit" card (R-24.14). Nothing to say → nothing shown. */
export function WhyFit({ fit }: { fit: FitResult }) {
  const lines = fitLines(fit);
  if (!lines.length) return null;
  return (
    <View testID="why-fit" style={{ backgroundColor: color.bgRaised, borderRadius: radius.md, padding: space.l, gap: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon.Spark size={16} c={fit.fit ? color.hookup : color.trust} />
        <Text accessibilityRole="header" style={{ ...type.headline, color: color.fgPrimary, flex: 1 }}>
          {mt.whyTitle}
        </Text>
        <Text style={{ ...type.meta, fontSize: 11, color: color.fgMuted }}>{mt.whySub}</Text>
      </View>
      <Lines lines={lines} />
    </View>
  );
}

// ---------------------------------------------------------------- sort chips (R-24.13)

export type Order = 'near' | 'fit';

export function SortChips({ order, onOrder, plus }: { order: Order; onOrder: (o: Order) => void; plus: boolean }) {
  const chip = (k: Order, label: string, extra?: React.ReactNode) => {
    const on = order === k;
    return (
      <Pressable
        key={k}
        testID={`order-${k}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        accessibilityLabel={label}
        onPress={() => onOrder(k)}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.m, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? color.trust : color.line, backgroundColor: on ? color.trust : 'transparent' },
          pressed && { opacity: 0.8 },
        ]}
      >
        {k === 'fit' ? <Icon.Spark size={13} c={on ? color.onAccent : color.trust} /> : null}
        <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 13, color: on ? color.onAccent : color.fgPrimary }}>{label}</Text>
        {extra}
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', gap: space.s, marginBottom: space.s }}>
      {chip('near', mt.nearest)}
      {chip('fit', mt.bestFit, plus ? null : <PlusTag size={14} />)}
    </View>
  );
}

// ---------------------------------------------------------------- Ask field (R-24.1)

export function AskBar({ plus, onAsk, onPlus }: { plus: boolean; onAsk: (text: string) => void; onPlus: () => void }) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [listening, setListening] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const recent = useRecent();
  const suggestions = recent.length ? recent.slice(0, 3) : mt.askSuggestions;
  const [canSpeak] = useState(() => plus && speech.supported());
  const send = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    input.current?.blur();
    addRecent(t);
    onAsk(t);
  };
  const submit = () => send(text);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  // R-24.1: hold the mic to dictate (on-device only); letting go sends what was heard.
  useEffect(() => {
    if (!canSpeak) return;
    return speech.on(
      (t, final) => {
        setText(t);
        if (final) {
          setListening(false);
          sendRef.current(t);
        }
      },
      () => setListening(false),
    );
  }, [canSpeak]);
  const hold = async () => {
    setListening(true);
    if (!(await speech.listen())) setListening(false);
  };
  return (
    <View style={{ gap: space.s }}>
      <Pressable
        testID="ask-bar"
        accessibilityRole={plus ? undefined : 'button'}
        accessibilityLabel={plus ? undefined : mt.askPlusA11y}
        onPress={plus ? () => input.current?.focus() : onPlus}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          minHeight: 44,
          paddingLeft: space.m,
          paddingRight: 6,
          borderRadius: 22,
          backgroundColor: 'rgba(23,20,46,0.86)',
          borderWidth: 1.5,
          borderColor: focused ? color.trust : color.line,
        }}
      >
        <Icon.Spark size={17} />
        {plus ? (
          <TextInput
            ref={input}
            testID="ask-input"
            accessibilityLabel={mt.askA11y}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={submit}
            placeholder={listening ? mt.askListening : mt.askPlaceholder}
            placeholderTextColor={color.fgMuted}
            returnKeyType="search"
            enterKeyHint="search"
            maxLength={200}
            autoCorrect
            style={{ flex: 1, ...type.body, fontSize: 14, color: color.fgPrimary, paddingVertical: 10 }}
          />
        ) : (
          <Text numberOfLines={1} style={{ flex: 1, ...type.body, fontSize: 14, color: color.fgMuted }}>
            {mt.askPlaceholder}
          </Text>
        )}
        {plus && canSpeak && !text.trim() ? (
          <Pressable
            testID="ask-mic"
            accessibilityRole="button"
            accessibilityLabel={listening ? mt.askListening : mt.askMic}
            onPressIn={hold}
            onPressOut={() => speech.stop()}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: listening ? color.trust : 'transparent', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon.Mic size={17} c={listening ? color.onAccent : color.fgSecondary} />
          </Pressable>
        ) : null}
        {plus ? (
          text.trim() ? (
            <Pressable testID="ask-go" accessibilityRole="button" accessibilityLabel={mt.askGo} onPress={submit} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' }}>
              <Icon.Search size={16} c={color.onAccent} />
            </Pressable>
          ) : null
        ) : (
          <View style={{ paddingRight: 6 }}>
            <PlusTag size={18} />
          </View>
        )}
      </Pressable>
      {plus && focused && !text ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="button"
              onPress={() => {
                setText(s);
                send(s);
              }}
              style={{ height: 30, paddingHorizontal: space.m, borderRadius: 15, backgroundColor: 'rgba(38,34,72,0.92)', borderWidth: 1, borderColor: color.line, justifyContent: 'center' }}
            >
              <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 12, color: color.fgPrimary }}>“{s}”</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- review sheet (R-24.4, R-24.5)

type Chip = { group: string; key: string; value?: string; label: string; tint: string };

function km(m: number) {
  return m < 1000 ? `${Math.round(m / 100) * 100} m` : `${Math.round(m / 100) / 10} km`.replace('.0 km', ' km');
}

export function chipsOf(r: AskResult): Chip[] {
  const f = r.filters;
  const out: Chip[] = [];
  const g = (group: string, key: string, label: string, tint: string, value?: string) => out.push({ group, key, value, label, tint });
  if (f.verified_only === true) g('who', 'verified_only', mt.verified, color.trust);
  if (f.verified_only === false) g('who', 'verified_only', mt.anyone, color.trust);
  if (f.online_now) g('who', 'online_now', mt.online, color.trust);
  if (f.new_members) g('who', 'new_members', mt.newMembers, color.trust);
  if (f.age_min || f.age_max) g('age', 'age', mt.age(f.age_min as number | undefined, f.age_max as number | undefined), color.trust);
  if (typeof f.distance_max === 'number') g('distance', 'distance_max', mt.within(km(f.distance_max)), color.trust);
  const each = (key: string, group: string, tint: string, label: (v: string) => string) => {
    for (const v of (f[key] as string[] | undefined) ?? []) g(group, key, label(v), tint, v);
  };
  each('position', 'position', color.hookup, (v) => opt(v, 'position'));
  each('hosting', 'hosting', color.hookup, (v) => opt(v, 'hosting'));
  each('looking_for', 'when', color.hookup, (v) => opt(v, 'looking_for'));
  if (f.has_now) g('when', 'has_now', mt.hasNow, color.hookup);
  each('tribes', 'tribes', color.friends, (v) => opt(v, 'tribes'));
  each('build', 'build', color.friends, (v) => opt(v, 'build'));
  each('orientation', 'orientation', color.friends, (v) => opt(v, 'orientation'));
  each('sports', 'sport', color.sport, (v) => opt(v, 'sports'));
  each('schedule', 'sport', color.sport, (v) => opt(v, 'schedule'));
  each('interests', 'interests', color.fgPrimary, (v) => `#${interestLabel(v)}`);
  for (const m of r.intents ?? []) g('mode', 'intents', tx.modes[m], modeColor[m], m);
  return out;
}

export function dropChip(r: AskResult, c: Chip): AskResult {
  const f = { ...r.filters };
  if (c.key === 'intents') {
    const left = (r.intents ?? []).filter((m) => m !== c.value);
    return { ...r, intents: left.length ? left : null };
  }
  if (c.key === 'age') {
    delete f.age_min;
    delete f.age_max;
  } else if (c.value !== undefined) {
    const left = ((f[c.key] as string[]) ?? []).filter((x) => x !== c.value);
    if (left.length) f[c.key] = left;
    else delete f[c.key];
  } else delete f[c.key];
  return { ...r, filters: f };
}

const GROUP_ORDER = ['mode', 'who', 'age', 'distance', 'position', 'hosting', 'when', 'tribes', 'build', 'orientation', 'sport', 'interests'];

export function AskSheet({
  ask,
  onChange,
  count,
  onApply,
  onEdit,
  onClose,
}: {
  ask: AskResult | null;
  onChange: (r: AskResult) => void;
  count: number | null;
  onApply: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const chips = useMemo(() => (ask ? chipsOf(ask) : []), [ask]);
  const groups = GROUP_ORDER.filter((gr) => chips.some((c) => c.group === gr));
  const any = !!ask && askHasFilters(ask);
  return (
    <Sheet visible={!!ask} onClose={onClose} title={mt.reviewTitle} closeLabel={mt.close}>
      {ask ? (
        <View testID="ask-sheet" style={{ gap: space.l }}>
          <Text style={{ ...type.meta, color: color.fgSecondary, marginTop: -space.s }}>{ask.refused.length ? mt.reviewRefusedSub : mt.reviewSub}</Text>
          {ask.refused.map((k: Refusal) => (
            <View key={k} testID={`ask-refused-${k}`} style={{ flexDirection: 'row', gap: space.s, padding: space.m, borderRadius: 14, backgroundColor: color.bgOverlay }}>
              <Text style={{ fontFamily: font.bold, color: color.personal, fontSize: 14 }}>!</Text>
              <Text style={{ ...type.meta, fontSize: 13, lineHeight: 18, color: color.fgPrimary, flex: 1 }}>{mt.refused[k]}</Text>
            </View>
          ))}
          {groups.length ? (
            <View>
              {groups.map((gr, i) => (
                <View key={gr} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: 10, borderBottomWidth: i === groups.length - 1 ? 0 : 1, borderBottomColor: color.lineSubtle }}>
                  <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted, width: 84 }}>{mt.groups[gr]}</Text>
                  <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {chips
                      .filter((c) => c.group === gr)
                      .map((c) => (
                        <Pressable
                          key={`${c.key}-${c.value ?? ''}`}
                          testID={`ask-chip-${c.key}${c.value ? '-' + c.value : ''}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${c.label}, ${mt.close}`}
                          onPress={() => onChange(dropChip(ask, c))}
                          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderColor: c.tint }, pressed && { opacity: 0.7 }]}
                        >
                          <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 13, color: c.tint }}>{c.label}</Text>
                          <Text style={{ fontSize: 11, color: c.tint, opacity: 0.75 }}>✕</Text>
                        </Pressable>
                      ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={{ ...type.body, color: color.fgSecondary }}>{mt.nothing}</Text>
          )}
          {ask.ignored.length ? <Text style={{ ...type.meta, color: color.fgMuted }}>{mt.ignored(ask.ignored.join(', '))}</Text> : null}
          {any ? (
            <Text testID="ask-count" style={{ ...type.meta, fontSize: 13, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>
              {count === null ? mt.counting : mt.count(count)}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <View style={{ flex: 1 }}>
              <Button kind="secondary" title={mt.edit} onPress={onEdit} />
            </View>
            <View style={{ flex: 1 }}>
              <Button testID="ask-apply" title={mt.show(any ? count : null)} fill={color.trust} disabled={!any} onPress={onApply} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.s, padding: space.m, borderRadius: 14, backgroundColor: color.bgRaised }}>
            <Icon.Lock size={13} />
            <Text style={{ ...type.meta, fontSize: 12, lineHeight: 17, color: color.fgSecondary, flex: 1 }}>{mt.privacy}</Text>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Picks row (R-24.20–R-24.25)

export type PickView = { card: Card; fit: FitResult; learned: Learned[] };

export function PicksRow({
  title,
  picks,
  pickedAt,
  onOpen,
  onMessage,
  onLess,
  onNotForMe,
  footer,
}: {
  title: string;
  picks: PickView[];
  pickedAt: string;
  onOpen: (c: Card) => void;
  onMessage: (c: Card) => void;
  onLess: (c: Card) => void;
  onNotForMe: (c: Card) => void;
  footer?: React.ReactNode;
}) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, 560) - space.l * 2;
  const [atRaw, setAt] = useState(0);
  const at = Math.min(atRaw, Math.max(0, picks.length - 1));
  return (
    <View testID="picks-row" style={{ gap: space.s, marginBottom: space.l }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon.Spark size={16} />
        <Text accessibilityRole="header" style={{ ...type.headline, color: color.fgPrimary, flex: 1 }}>
          {title}
        </Text>
        {picks.length ? <Text style={{ ...type.meta, color: color.fgSecondary, fontVariant: ['tabular-nums'] }}>{mt.picksOf(at + 1, picks.length)}</Text> : null}
      </View>
      {picks.length ? (
        <>
          <FlatList
            horizontal
            pagingEnabled
            snapToInterval={w + space.s}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            data={picks}
            keyExtractor={(p) => p.card.id}
            ItemSeparatorComponent={() => <View style={{ width: space.s }} />}
            onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / (w + space.s)))}
            renderItem={({ item }) => <PickCard p={item} w={w} pickedAt={pickedAt} onOpen={onOpen} onMessage={onMessage} onLess={onLess} onNotForMe={onNotForMe} />}
          />
          {picks.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              {picks.map((p, i) => (
                <View key={p.card.id} style={{ width: i === at ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === at ? color.trust : color.line }} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {footer}
    </View>
  );
}

function PickCard({ p, w, pickedAt, onOpen, onMessage, onLess, onNotForMe }: { p: PickView; w: number; pickedAt: string; onOpen: (c: Card) => void; onMessage: (c: Card) => void; onLess: (c: Card) => void; onNotForMe: (c: Card) => void }) {
  const c = p.card;
  const lines = fitLines(p.fit).filter((l) => l.key !== 'ok');
  const learned = p.learned.length ? [{ key: 'learned', glyph: '↺', tint: color.friends, strong: mt.why.learned(p.learned.map(traitLabel).join(', ')) }] : [];
  const shown = [...lines.slice(0, learned.length ? 2 : 3), ...learned];
  const action = (label: string, on: () => void, tint: string, testID: string) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}, ${c.display_name}`} onPress={on} style={({ pressed }) => [{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { backgroundColor: color.bgOverlay }]}>
      <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 13, color: tint }}>{label}</Text>
    </Pressable>
  );
  return (
    <View testID={`pick-${c.id}`} style={{ width: w, borderRadius: 20, backgroundColor: color.bgRaised, borderWidth: 1, borderColor: color.line, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${c.display_name}, ${c.age}, ${distanceLabel(c.distance)}`} onPress={() => onOpen(c)} style={{ height: 156 }}>
        <Photo uri={c.photo} id={c.id} label={`${c.display_name}'s photo`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <Scrim height="70%" max={0.85} />
        <View style={{ position: 'absolute', right: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(23,20,46,0.8)' }}>
          <Text style={{ ...type.caption, fontSize: 10.5, color: color.fgSecondary }}>{mt.pickedAt(pickedAt)}</Text>
        </View>
        <View style={{ position: 'absolute', left: space.m, right: space.m, bottom: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text numberOfLines={1} style={{ ...type.title, fontSize: 20, color: color.fgPrimary, flexShrink: 1 }}>
              {c.display_name}, {c.age}
            </Text>
            {c.verified ? <VerifiedTick size={14} /> : null}
          </View>
          <Text style={{ ...type.meta, fontSize: 12, color: color.fgSecondary }}>{[distanceLabel(c.distance), c.online ? mt.online2 : null].filter(Boolean).join(' · ')}</Text>
        </View>
      </Pressable>
      <View style={{ padding: space.m }}>
        <Lines lines={shown} small />
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: color.line }}>
        {action(mt.notForMe, () => onNotForMe(c), color.fgSecondary, `pick-not-${c.id}`)}
        <View style={{ width: 1, backgroundColor: color.line }} />
        {action(mt.less, () => onLess(c), color.fgSecondary, `pick-less-${c.id}`)}
        <View style={{ width: 1, backgroundColor: color.line }} />
        {action(mt.message, () => onMessage(c), color.hookup, `pick-msg-${c.id}`)}
      </View>
    </View>
  );
}

/** Free (R-24.25): one quiet card, ✕ hides it for 7 days. Never in the first 3 days. */
export function PicksPlusCard({ onPlus, onHide }: { onPlus: () => void; onHide: () => void }) {
  return (
    <View testID="picks-plus" style={{ borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.line, padding: space.l, gap: space.s, marginBottom: space.l }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon.Spark size={16} />
        <Text style={{ ...type.headline, color: color.fgPrimary, flex: 1 }}>{mt.plusTitle}</Text>
        <PlusTag size={16} />
      </View>
      <Text style={{ ...type.meta, fontSize: 13, lineHeight: 18, color: color.fgSecondary }}>{mt.plusSub}</Text>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <View style={{ flex: 1 }}>
          <Button small kind="secondary" title={mt.seePlus} onPress={onPlus} />
        </View>
        <Pressable testID="picks-plus-hide" accessibilityRole="button" accessibilityLabel={mt.hide} onPress={onHide} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon.Close c={color.fgMuted} />
        </Pressable>
      </View>
    </View>
  );
}

export function PicksDone({ n, next, onRefresh, refreshIn }: { n: number; next: string; onRefresh?: () => void; refreshIn?: number | null }) {
  return (
    <View testID="picks-done" style={{ borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.line, padding: space.l, gap: 6 }}>
      <Text style={{ ...type.headline, color: color.fgPrimary }}>{n ? mt.doneTitle(n) : mt.emptyPicks}</Text>
      {n ? <Text style={{ ...type.meta, color: color.fgSecondary }}>{mt.doneSub(next)}</Text> : null}
      {onRefresh ? (
        <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
          <Button small kind="secondary" title={mt.refresh} onPress={onRefresh} />
        </View>
      ) : refreshIn ? (
        <Text style={{ ...type.meta, color: color.fgMuted }}>{mt.refreshIn(refreshIn)}</Text>
      ) : null}
    </View>
  );
}

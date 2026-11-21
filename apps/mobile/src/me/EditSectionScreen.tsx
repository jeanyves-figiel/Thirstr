import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { Visibility } from '../api/types';
import { opt, tx } from '../i18n/app';
import { pe } from '../i18n/profileEdit';
import { NAME_MAX } from '../onboarding/flow';
import { fieldType, maxLen, optionKey } from '../profile/fieldMeta';
import { filled, nextSection, sectionKeys, SECTIONS, type SectionId } from '../profile/sections';
import { color, font, modeColor, radius, space, type } from '../theme/tokens';
import { Banner, Button, Chip, Chips, ErrorText, Field, Icon, Loading, Section, Sheet, StickyCta, Toggle } from '../ui';
import { type SaveState, useProfileDraft } from './useProfileDraft';

type Nav = { goBack: () => void; replace: (s: string, p?: object) => void };
type Params = { id?: string; section: SectionId; focus?: string };
const VIS: Visibility[] = ['public', 'verified', 'chats', 'only_me'];

// S-75 Edit section (#219, R-06.8b): one section's fields, each with its own "who sees this"
// (R-06.4). No Save button: changes save 800 ms after the last edit and when leaving.
export function EditSectionScreen({ route, navigation }: { route: { params: Params }; navigation: Nav }) {
  const { section, focus } = route.params;
  const d = useProfileDraft(route.params.id);
  const [visFor, setVisFor] = useState<string | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [focusY, setFocusY] = useState<number | null>(null);
  useEffect(() => {
    if (focusY !== null) scroll.current?.scrollTo({ y: Math.max(0, focusY - space.l), animated: true });
  }, [focusY]);

  const { options, profile } = d;
  if (!options || !profile) return <Loading />;

  const meta = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  const keys = sectionKeys(section, (k) => !!options.defaults[k]);
  const total = keys.length + (section === 'basics' ? 1 : 0);
  const done = keys.filter((k) => filled(d.vals[k])).length + (section === 'basics' && d.name.trim() ? 1 : 0);
  const accent = meta.lens ? modeColor[meta.lens] : section === 'health' ? color.trust : color.fgPrimary;
  const caption = pe.shownIn[meta.lens ?? (section === 'health' ? 'health' : 'all')];
  const next = nextSection(section);
  const tone = meta.lens ? modeColor[meta.lens] : color.hookup;

  const input = (k: string) => {
    const t = fieldType(k);
    const v = d.vals[k];
    const label = tx.edit.fields[k] ?? k;
    const choices = options.options[optionKey(k)] ?? [];
    const error = d.fieldErr[k]?.[0];
    switch (t) {
      case 'bool':
        return (
          <Section>
            <Toggle label={label} value={!!v} onChange={(x) => d.set(k, x)} tone={tone} />
          </Section>
        );
      case 'text':
        return <Field bare label={label} value={(v as string) ?? ''} onChangeText={(x) => d.set(k, x)} maxLength={maxLen(k)} multiline={maxLen(k) > 60} error={error} />;
      case 'int':
        return <Field bare label={label} keyboardType="number-pad" value={v ? String(v) : ''} onChangeText={(x) => d.set(k, x ? Number.parseInt(x, 10) || null : null)} error={error} />;
      case 'month':
        return <Field bare label={label} value={(v as string) ?? ''} placeholder="2026-10" onChangeText={(x) => d.set(k, x)} error={error} />;
      case 'multi': {
        const cur = (v as string[]) ?? [];
        return (
          <Chips>
            {choices.map((c) => (
              <Chip key={c} label={opt(c, k)} on={cur.includes(c)} fill={tone} onPress={() => d.set(k, cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c])} />
            ))}
          </Chips>
        );
      }
      default:
        return (
          <Chips>
            {choices.map((c) => (
              <Chip key={c} label={opt(c, k)} on={v === c} fill={tone} onPress={() => d.set(k, v === c ? null : c)} />
            ))}
          </Chips>
        );
    }
  };

  const visPill = (k: string) => {
    const vv = d.visOf(k);
    const priv = vv === 'chats' || vv === 'only_me';
    return (
      <Pressable
        testID={`vis-${k}`}
        accessibilityRole="button"
        accessibilityLabel={`${tx.edit.visibility}: ${tx.edit.vis[vv]}`}
        onPress={() => setVisFor(k)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: pressed ? `${color.trust}33` : `${color.trust}1A` })}
      >
        {priv ? <Icon.Lock size={12} /> : <Icon.Eye size={13} c={color.trust} />}
        <Text style={{ ...type.caption, fontSize: 12, color: color.trust }}>{tx.edit.vis[vv]}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase }}>
      <ScrollView showsVerticalScrollIndicator={false}
        ref={scroll}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: space.l, paddingTop: space.xs, gap: space.l, paddingBottom: 240, maxWidth: 560, width: '100%', alignSelf: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={{ ...type.display, fontSize: 28, lineHeight: 34, color: color.fgPrimary }}>
              {pe.sections[section]}
            </Text>
            <Text style={{ ...type.meta, fontFamily: font.bold, color: accent === color.fgPrimary ? color.fgSecondary : accent }}>
              {caption} · {pe.of(done, total)}
            </Text>
          </View>
          <SaveChip state={d.state} />
        </View>

        {section === 'health' ? <Banner tone="trust" text={tx.edit.healthNote} /> : null}

        {section === 'basics' ? (
          <View style={{ gap: space.s, paddingBottom: space.l, borderBottomWidth: 1, borderBottomColor: color.lineSubtle }}>
            <Text style={labelStyle}>{pe.name}</Text>
            <Field bare testID="edit-name" label={pe.name} value={d.name} onChangeText={d.setName} maxLength={NAME_MAX} error={d.fieldErr.display_name?.[0]} />
          </View>
        ) : null}

        {keys.map((k, i) => (
          <View
            key={k}
            testID={`field-${k}`}
            onLayout={k === focus ? (e) => setFocusY(e.nativeEvent.layout.y) : undefined}
            style={{ gap: space.s, paddingBottom: space.l, borderBottomWidth: i === keys.length - 1 ? 0 : 1, borderBottomColor: color.lineSubtle }}
          >
            {fieldType(k) === 'bool' ? (
              <>
                {input(k)}
                {visPill(k)}
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, minHeight: 32 }}>
                  <Text style={[labelStyle, { flex: 1 }]}>{tx.edit.fields[k] ?? k}</Text>
                  {visPill(k)}
                </View>
                {input(k)}
              </>
            )}
            {['chats', 'only_me'].includes(d.visOf(k)) && section !== 'health' ? <Text style={{ ...type.meta, color: color.fgMuted }}>{tx.edit.chatsNote}</Text> : null}
          </View>
        ))}

        {d.state === 'error' ? (
          <View style={{ gap: space.s }}>
            <ErrorText text={d.err} />
            <Button small kind="secondary" title={pe.retry} onPress={d.retry} />
          </View>
        ) : null}

        <Sheet visible={!!visFor} onClose={() => setVisFor(null)} title={tx.edit.visibility} closeLabel={tx.common.close}>
          {visFor ? (
            <Section>
              {VIS.filter((x) => !(options.health.includes(visFor) && x === 'public')).map((x) => (
                <Pressable
                  key={x}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: d.visOf(visFor) === x }}
                  onPress={() => {
                    d.setVis(visFor, x);
                    setVisFor(null);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56 }}
                >
                  <Text style={{ ...type.headline, fontFamily: font.bold, color: color.fgPrimary, flex: 1 }}>{tx.edit.vis[x]}</Text>
                  {d.visOf(visFor) === x ? (
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color.trust, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon.Check size={14} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </Section>
          ) : null}
        </Sheet>
      </ScrollView>
      <StickyCta>
        <Button
          testID="section-next"
          title={next ? pe.next(pe.sections[next]) : pe.done}
          fill={color.fgPrimary}
          onPress={() => (next ? navigation.replace('EditSection', { id: profile.id, section: next }) : navigation.goBack())}
        />
      </StickyCta>
    </View>
  );
}

const labelStyle = { ...type.headline, color: color.fgPrimary };

/** Autosave state for S-74/S-75 headers: spinner while saving, teal check once saved. */
export function SaveChip({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const err = state === 'error';
  return (
    <View testID="save-state" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, marginTop: 4 }}>
      {state === 'saving' ? <ActivityIndicator size="small" color={color.fgSecondary} /> : err ? null : <Icon.Check size={13} c={color.trust} />}
      <Text style={{ ...type.meta, fontFamily: font.bold, color: err ? color.danger : state === 'saving' ? color.fgSecondary : color.trust }}>
        {state === 'saving' ? pe.saving : err ? pe.notSaved : pe.saved}
      </Text>
    </View>
  );
}

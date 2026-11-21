import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { tx } from '../i18n/app';
import { ppl } from '../i18n/people';
import { color, font, radius, space, type } from '../theme/tokens';
import { Button, Icon, Sheet } from '../ui';
import * as P from '../chat/people';

// R-06.9 / R-07.35 (#115): private note + tags on someone else's profile. Device-only, never sent.

/** Profile S-20 card. */
export function PrivateNote({ profileId }: { profileId: string }) {
  P.usePeople();
  const [open, setOpen] = useState(false);
  const note = P.noteFor(profileId);
  return (
    <>
      <Pressable
        testID="note-card"
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.personal, borderRadius: radius.md, padding: space.m, gap: space.s }}
      >
        <Text style={{ ...type.caption, color: color.personal, textTransform: 'uppercase' }}>{tx.profile.privateNote} · {tx.profile.onlyYou}</Text>
        {note?.text ? <Text style={{ ...type.body, color: color.fgPrimary }}>{note.text}</Text> : !note?.tags.length ? <Text style={{ ...type.meta, color: color.fgMuted }}>{tx.profile.addNote}</Text> : null}
        {note?.tags.length ? <Tags tags={note.tags} /> : null}
      </Pressable>
      <NoteSheet peer={profileId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Chat S-41 strip under the header (only when a note exists). */
export function NoteStrip({ peer, onPress }: { peer: string; onPress: () => void }) {
  P.usePeople();
  const note = P.noteFor(peer);
  if (!note) return null;
  return (
    <Pressable
      testID="note-strip"
      accessibilityRole="button"
      accessibilityLabel={ppl.editNote}
      onPress={onPress}
      style={({ pressed }) => ({ marginHorizontal: space.m, marginTop: space.s, paddingHorizontal: space.m, paddingVertical: 10, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.personal, flexDirection: 'row', alignItems: 'flex-start', gap: 10, opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ marginTop: 2 }}>
        <Icon.Pen />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        {note.text ? (
          <Text numberOfLines={2} style={{ ...type.body, fontSize: 14, lineHeight: 19, color: color.fgPrimary }}>
            {note.text}
          </Text>
        ) : null}
        {note.tags.length ? <Tags tags={note.tags} small /> : null}
      </View>
      <Text style={{ ...type.caption, color: color.personal, textTransform: 'uppercase', letterSpacing: 0.6 }}>{ppl.onlyYou}</Text>
    </Pressable>
  );
}

function Tags({ tags, small }: { tags: string[]; small?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {tags.map((t) => (
        <View key={t} style={{ paddingHorizontal: small ? 9 : 11, paddingVertical: small ? 2 : 4, borderRadius: radius.pill, backgroundColor: color.personal }}>
          <Text style={{ ...type.caption, fontSize: 12, color: color.onAccent }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** Editor sheet: note text, tag chips (own tags as suggestions), Save. */
export function NoteSheet({ peer, visible, onClose }: { peer: string; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title={ppl.noteTitle} closeLabel={tx.common.close}>
      {visible ? <NoteEditor key={peer} peer={peer} onClose={onClose} /> : null}
    </Sheet>
  );
}

function NoteEditor({ peer, onClose }: { peer: string; onClose: () => void }) {
  const [text, setText] = useState(() => P.noteFor(peer)?.text ?? '');
  const [tags, setTags] = useState<string[]>(() => P.noteFor(peer)?.tags ?? []);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const suggestions = P.myTags()
    .map((x) => x.tag)
    .filter((t) => !tags.includes(t))
    .slice(0, 8);
  const full = tags.length >= P.TAGS_MAX;
  const addDraft = () => {
    const t = draft.trim().replace(/^#/, '').slice(0, 30);
    if (t && !tags.includes(t) && !full) setTags([...tags, t]);
    setDraft('');
    setAdding(false);
  };
  const save = async () => {
    await P.setNote(peer, { text, tags: draft.trim() ? [...tags, draft.trim()] : tags });
    onClose();
  };
  const had = !!P.noteFor(peer);

  const chip = (on: boolean) => ({ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: on ? color.personal : color.bgOverlay, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 });

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon.Lock c={color.personal} />
        <Text style={{ ...type.caption, fontSize: 12, color: color.personal }}>{ppl.noteOnlyYou}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 0.8, color: color.fgMuted, textTransform: 'uppercase' }}>{ppl.noteLabel}</Text>
        <TextInput
          testID="note-text"
          value={text}
          onChangeText={setText}
          maxLength={P.NOTE_MAX}
          multiline
          placeholder={ppl.notePh}
          placeholderTextColor={color.fgMuted}
          style={{ minHeight: 88, backgroundColor: color.bgOverlay, borderWidth: 2, borderColor: color.personal, borderRadius: 18, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, color: color.fgPrimary, fontFamily: font.regular, fontSize: 15, lineHeight: 21, textAlignVertical: 'top' }}
        />
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted, textAlign: 'right' }}>
          {text.length}/{P.NOTE_MAX}
        </Text>
      </View>
      <View style={{ gap: space.s }}>
        <Text style={{ ...type.caption, fontSize: 12, letterSpacing: 0.8, color: color.fgMuted, textTransform: 'uppercase' }}>
          {ppl.tagsLabel} · {tags.length}/{P.TAGS_MAX}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
          {tags.map((t) => (
            <Pressable key={'t' + t} testID={`tag-${t}`} accessibilityRole="button" accessibilityLabel={`${t}, ${tx.common.delete}`} onPress={() => setTags(tags.filter((x) => x !== t))} style={chip(true)}>
              <Text style={{ ...type.body, fontSize: 14, fontFamily: font.bold, color: color.onAccent }}>{t}</Text>
              <Icon.Close size={13} c={color.onAccent} />
            </Pressable>
          ))}
          {!full
            ? suggestions.map((t) => (
                <Pressable key={'s' + t} accessibilityRole="button" onPress={() => setTags([...tags, t])} style={chip(false)}>
                  <Text style={{ ...type.body, fontSize: 14, fontFamily: font.bold, color: color.fgSecondary }}>{t}</Text>
                </Pressable>
              ))
            : null}
          {!full ? (
            adding ? (
              <TextInput
                testID="tag-input"
                autoFocus
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={addDraft}
                onBlur={addDraft}
                maxLength={30}
                autoCapitalize="none"
                returnKeyType="done"
                placeholder={ppl.tagPh}
                placeholderTextColor={color.fgMuted}
                style={{ height: 36, minWidth: 110, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.personal, color: color.fgPrimary, fontFamily: font.bold, fontSize: 14, paddingVertical: 0 }}
              />
            ) : (
              <Pressable testID="tag-add" accessibilityRole="button" onPress={() => setAdding(true)} style={{ ...chip(false), backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.fgMuted }}>
                <Icon.Plus size={14} c={color.fgSecondary} />
                <Text style={{ ...type.body, fontSize: 14, fontFamily: font.bold, color: color.fgSecondary }}>{ppl.addTag}</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{ppl.noteKept}</Text>
      <Button testID="note-save" title={ppl.saveNote} fill={color.personal} onPress={save} />
      {had ? (
        <Pressable accessibilityRole="button" onPress={() => P.setNote(peer, { text: '', tags: [] }).then(onClose)} style={{ alignSelf: 'center', padding: space.s }}>
          <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.danger }}>{ppl.deleteNote}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

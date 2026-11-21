import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Card } from '../api/types';
import { mx } from '../i18n/moments';
import { color, font, space, type } from '../theme/tokens';
import { Photo } from '../ui';
import { onSeen, watchedAll } from './api';
import { RingAvatar } from './Ring';

export const ROW_MAX = 30;

/** R-21.10: people with Moments, unseen first, each group nearest first (grid order), max 30. */
export function rowPeople(items: Card[]): Card[] {
  const withM = items.filter((c) => c.moments && c.moments.live > 0);
  const unseen = (c: Card) => !!c.moments?.unseen && !watchedAll(c.id);
  return [...withM.filter(unseen), ...withM.filter((c) => !unseen(c))].slice(0, ROW_MAX);
}

type Props = {
  items: Card[];
  myPhoto: string | null;
  myId: string;
  myLive: number;
  onAdd: () => void;
  onMine: () => void;
  onOpen: (queue: Card[], index: number) => void;
};

// S-10 Moments row on top of the grid sheet (F-21 R-21.10, D-21a B): "＋ You" first.
export function MomentsRow({ items, myPhoto, myId, myLive, onAdd, onMine, onOpen }: Props) {
  const [, bump] = useState(0);
  useEffect(() => onSeen(() => bump((n) => n + 1)), []);
  const people = useMemo(() => rowPeople(items), [items]);
  if (!people.length && myLive === 0 && !items.length) return null;
  return (
    <ScrollView testID="moments-row" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.m, paddingHorizontal: space.l, paddingBottom: space.m }} style={{ marginHorizontal: -space.l }}>
      <Pressable testID="moments-add" accessibilityRole="button" accessibilityLabel={myLive ? mx.yourMoment : mx.addA11y} onPress={myLive ? onMine : onAdd} onLongPress={onAdd} style={{ width: 64, alignItems: 'center', gap: 4 }}>
        <View>
          <RingAvatar size={64} unseen={false} ring={myLive > 0}>
            <Photo uri={myPhoto} id={myId} label="" style={{ width: '100%', height: '100%' }} />
          </RingAvatar>
          <Pressable accessibilityRole="button" accessibilityLabel={mx.addA11y} onPress={onAdd} hitSlop={8} style={{ position: 'absolute', right: -1, bottom: -1, width: 22, height: 22, borderRadius: 11, backgroundColor: color.hookup, borderWidth: 2.5, borderColor: color.bgBase, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 15, lineHeight: 17, color: color.onAccent }}>+</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={{ ...type.caption, fontFamily: font.bold, color: color.fgSecondary }}>
          {mx.you}
        </Text>
      </Pressable>
      {people.map((c, i) => {
        const unseen = !!c.moments?.unseen && !watchedAll(c.id);
        return (
          <Pressable key={c.id} testID={`moment-${c.id}`} accessibilityRole="button" accessibilityLabel={mx.openA11y(c.display_name, c.moments?.live ?? 0, unseen)} onPress={() => onOpen(people, i)} style={({ pressed }) => [{ width: 64, alignItems: 'center', gap: 4 }, pressed && { transform: [{ scale: 0.95 }] }]}>
            <RingAvatar size={64} unseen={unseen}>
              <Photo uri={c.moments?.thumb || c.photo} id={c.id} label="" style={{ width: '100%', height: '100%' }} />
            </RingAvatar>
            <Text numberOfLines={1} style={{ ...type.caption, fontFamily: font.bold, color: unseen ? color.fgPrimary : color.fgSecondary, maxWidth: 64 }}>
              {c.display_name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

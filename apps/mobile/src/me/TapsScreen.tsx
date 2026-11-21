import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { api } from '../api/client';
import type { Tap } from '../api/types';
import { tx } from '../i18n/app';
import { color, radius, space, type } from '../theme/tokens';
import { usePull } from '../ui/pull';
import { EmptyState, Icon, Loading, Photo, VerifiedTick } from '../ui';

type Nav = { navigate: (s: string, p?: object) => void };

// F-08 taps received (7 days, R-08.2). Opening marks them seen.
export function TapsScreen({ navigation }: { navigation: Nav }) {
  const [list, setList] = useState<Tap[] | null>(null);
  const [back, setBack] = useState<Record<string, boolean>>({});
  const load = useCallback(
    () =>
      api<{ taps: Tap[] }>('GET', '/taps')
        .then((r) => {
          setList(r.taps);
          api('POST', '/taps/seen').catch(() => {});
        })
        .catch(() => setList((l) => l ?? [])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const refresh = usePull(load); // F-19 G6
  if (!list) return <Loading />;
  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: space.s }}>
      <Text style={{ ...type.display, color: color.fgPrimary, paddingHorizontal: space.l }}>{tx.me.taps}</Text>
      {list.length === 0 ? (
        <EmptyState title={tx.me.noTaps} />
      ) : (
        <FlatList showsVerticalScrollIndicator={false}
          refreshControl={refresh}
          data={list}
          keyExtractor={(t) => t.profile.id + t.at}
          contentContainerStyle={{ padding: space.l, gap: space.s, paddingBottom: 140 }}
          renderItem={({ item }) => {
            const mutual = item.mutual || back[item.profile.id];
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Profile', { id: item.profile.id })}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.s + 2, borderRadius: radius.md, backgroundColor: mutual ? `${color.hookup}1A` : color.bgRaised, opacity: pressed ? 0.85 : 1 })}
              >
                <View>
                  <Photo uri={item.profile.photo} id={item.profile.id} label="" style={{ width: 56, height: 56, borderRadius: radius.pill }} />
                  <View style={{ position: 'absolute', right: -3, bottom: -3, width: 24, height: 24, borderRadius: 12, backgroundColor: color.hookup, borderWidth: 3, borderColor: color.bgBase, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon.Flame size={11} c={color.onAccent} fill={color.onAccent} />
                  </View>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text numberOfLines={1} style={{ ...type.headline, color: color.fgPrimary, flexShrink: 1 }}>
                      {item.profile.display_name}, {item.profile.age}
                    </Text>
                    {item.profile.verified ? <VerifiedTick size={13} /> : null}
                    {!item.seen ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color.hookup, marginLeft: 2 }} /> : null}
                  </View>
                  <Text numberOfLines={2} style={{ ...type.meta, color: mutual ? color.hookup : color.fgMuted }}>
                    {mutual ? tx.profile.mutual : new Date(item.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    mutual
                      ? navigation.navigate('Chat', { profileId: item.profile.id, name: item.profile.display_name })
                      : api('POST', `/profiles/${item.profile.id}/tap`).then(() => setBack((b) => ({ ...b, [item.profile.id]: true })), () => {})
                  }
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: mutual ? color.hookup : color.line }}
                >
                  <Icon.Flame size={15} c={mutual ? color.onAccent : color.fgPrimary} fill={mutual ? color.onAccent : color.fgPrimary} />
                  <Text style={{ ...type.meta, fontFamily: type.headline.fontFamily, color: mutual ? color.onAccent : color.fgPrimary }}>{mutual ? tx.profile.message : tx.explore.quick.tap}</Text>
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

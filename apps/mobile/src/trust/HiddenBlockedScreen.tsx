import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { api } from '../api/client';
import { mod } from '../i18n/mod';
import { color, radius, space, type } from '../theme/tokens';
import { EmptyState, Loading, Photo, Segmented } from '../ui';
import { usePull } from '../ui/pull';
import { toast } from '../ui/Toast';

// S-71 Hidden & blocked (#111, F-15 R-15.21): two tabs, newest first, Unhide / Unblock per row.
type Item = {
  profile_id: string;
  display_name: string;
  age?: number | null;
  photo?: string | null;
  at: string;
};
type Tab = 'hidden' | 'blocked';

const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));

export function HiddenBlockedScreen({ route }: { route?: { params?: { tab?: Tab } } }) {
  const [tab, setTab] = useState<Tab>(route?.params?.tab ?? 'hidden');
  const [hidden, setHidden] = useState<Item[] | null>(null);
  const [blocked, setBlocked] = useState<Item[] | null>(null);
  const load = useCallback(
    () =>
      Promise.all([
        api<{ hidden: Item[] }>('GET', '/me/hidden').then(
          (r) => setHidden(r.hidden),
          () => setHidden([]),
        ),
        api<{ blocks: Item[] }>('GET', '/me/blocks').then(
          (r) => setBlocked(r.blocks),
          () => setBlocked([]),
        ),
      ]),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const refresh = usePull(load); // F-19 G6

  const list = tab === 'hidden' ? hidden : blocked;
  const undo = (it: Item) => {
    const isHidden = tab === 'hidden';
    (isHidden ? setHidden : setBlocked)((l) => (l ?? []).filter((x) => x.profile_id !== it.profile_id));
    api('DELETE', isHidden ? `/profiles/${it.profile_id}/hide` : `/me/blocks/${it.profile_id}`).then(
      () => toast(isHidden ? mod.list.unhidden(it.display_name) : mod.list.unblocked(it.display_name)),
      load,
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bgBase, paddingTop: space.s }}>
      <View style={{ paddingHorizontal: space.l, gap: space.m }}>
        <Text accessibilityRole="header" style={{ ...type.display, color: color.fgPrimary }}>
          {mod.list.title}
        </Text>
        <Segmented
          grow
          label={mod.list.title}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'hidden', label: mod.list.hiddenTab(hidden?.length ?? 0) },
            {
              value: 'blocked',
              label: mod.list.blockedTab(blocked?.length ?? 0),
            },
          ]}
        />
        <View
          style={{
            backgroundColor: color.bgRaised,
            borderRadius: radius.md - 6,
            padding: space.m,
          }}
        >
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{tab === 'hidden' ? mod.list.hiddenWhy : mod.list.blockedWhy}</Text>
        </View>
      </View>
      {!list ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState title={tab === 'hidden' ? mod.list.emptyHidden : mod.list.emptyBlocked} body={mod.list.emptySub} />
      ) : (
        <FlatList showsVerticalScrollIndicator={false}
          refreshControl={refresh}
          data={list}
          keyExtractor={(b) => b.profile_id}
          contentContainerStyle={{ padding: space.l, gap: space.m }}
          renderItem={({ item }) => (
            <View
              testID={`hb-${item.profile_id}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.m,
              }}
            >
              <Photo uri={item.photo} id={item.profile_id} label={item.display_name} style={{ width: 46, height: 46, borderRadius: 16 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.headline, color: color.fgPrimary }} numberOfLines={1}>
                  {item.age ? `${item.display_name}, ${item.age}` : item.display_name}
                </Text>
                <Text style={{ ...type.meta, color: color.fgMuted }}>{mod.list.ago(days(item.at))}</Text>
              </View>
              <Pressable
                testID={`hb-undo-${item.profile_id}`}
                accessibilityRole="button"
                onPress={() => undo(item)}
                style={({ pressed }) => ({
                  paddingHorizontal: space.l,
                  height: 36,
                  borderRadius: radius.pill,
                  backgroundColor: color.bgOverlay,
                  justifyContent: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  style={{
                    ...type.headline,
                    fontSize: 13,
                    color: color.fgPrimary,
                  }}
                >
                  {tab === 'hidden' ? mod.list.unhide : mod.list.unblock}
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

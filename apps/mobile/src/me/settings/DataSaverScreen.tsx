// S-61 › App › Data saver (F-17 R-17.16, #177, mockup board 6).
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { type SaverMode, setMode, useDataSaver } from '../../app/dataSaver';
import { sv } from '../../i18n/saver';
import { color, font, space, type } from '../../theme/tokens';
import { Group, Page } from './parts';

const OPTS: [SaverMode, string, string][] = [
  ['auto', sv.auto, sv.autoSub],
  ['always', sv.always, sv.alwaysSub],
  ['off', sv.off, sv.offSub],
];

export function DataSaverSettings() {
  const { mode } = useDataSaver();
  return (
    <Page title={sv.title}>
      <Group>
        {OPTS.map(([id, title, sub]) => {
          const on = mode === id;
          return (
            <Pressable
              key={id}
              testID={`saver-${id}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={title}
              onPress={() => setMode(id)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 60, paddingHorizontal: space.l, paddingVertical: space.s, backgroundColor: pressed ? color.bgOverlay : 'transparent' })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ ...type.body, fontFamily: font.bold, fontSize: 16, color: color.fgPrimary }}>{title}</Text>
                <Text style={{ ...type.meta, color: color.fgSecondary }}>{sub}</Text>
              </View>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? color.trust : color.fgMuted, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.trust }} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Group>
      <Group label={sv.whileOn} hint={sv.never}>
        {sv.rules.map((r) => (
          <View key={r} style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.m }}>
            <Text style={{ ...type.body, color: color.trust }}>✓</Text>
            <Text style={{ ...type.body, flex: 1, color: color.fgPrimary }}>{r}</Text>
          </View>
        ))}
      </Group>
    </Page>
  );
}

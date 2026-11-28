import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '../app/session';
import { mt } from '../i18n/match';
import { Group, Page, Row, SwitchRow, useSettings } from '../me/settings/parts';
import { PlusTag } from '../plus/PlusLimit';
import { aiOn } from '../plus/plus';
import { color, font, radius, space, type } from '../theme/tokens';
import { toast } from '../ui/Toast';
import { forget, learnedTraits, loadState, type Learned } from './picks';
import { clearRecent } from './recent';
import { setPrefs, useMatchState } from './store';
import { traitLabel } from './ui';

// F-24 R-24.30 (#338): Settings › Privacy › Ask, Fit & Picks. Every switch works alone. What Picks
// learned is shown in plain words (R-24.24), so nothing is a black box.
export function AiSettingsScreen() {
  const { me } = useSession();
  const nav = useNavigation<{ navigate: (s: string, p?: object) => void }>();
  const { prefs } = useMatchState();
  const { st, put, err } = useSettings();
  const [traits, setTraits] = useState<Learned[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const plus = aiOn(me);
  useEffect(() => {
    loadState().then((s) => setTraits(learnedTraits(s.model, 6)));
  }, []);
  if (!st) return <Page title={mt.settingsTitle} loading />;
  return (
    <Page title={mt.settingsTitle} err={err}>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{mt.settingsIntro}</Text>
      {!plus ? <Row testID="ai-plus" title={mt.benefit[0]} sub={mt.benefit[1]} left={<PlusTag size={20} />} onPress={() => nav.navigate('Plus', { from: 'ai_match' })} /> : null}
      <Group>
        <SwitchRow testID="ai-ask" title={mt.sAsk[0]} sub={mt.sAsk[1]} value={prefs.ask} onChange={(v) => setPrefs({ ask: v })} tone={color.trust} />
        <SwitchRow testID="ai-fit" title={mt.sFit[0]} sub={mt.sFit[1]} value={prefs.fit} onChange={(v) => setPrefs({ fit: v })} tone={color.trust} />
        <SwitchRow testID="ai-picks" title={mt.sPicks[0]} sub={mt.sPicks[1]} value={prefs.picks} onChange={(v) => setPrefs({ picks: v })} tone={color.trust} />
        <SwitchRow testID="ai-learn" title={mt.sLearn[0]} sub={mt.sLearn[1]} value={prefs.learn} onChange={(v) => setPrefs({ learn: v })} tone={color.trust} />
      </Group>
      <Group>
        <SwitchRow testID="ai-count-me" title={mt.sCountMe[0]} sub={mt.sCountMe[1]} value={st.fit_visible !== false} onChange={(v) => put({ fit_visible: v })} tone={color.trust} />
      </Group>
      <Group label={mt.learnedTitle}>
        <View testID="ai-learned" style={{ paddingHorizontal: space.l, paddingVertical: space.m, gap: space.s }}>
          {traits && traits.length ? (
            <>
              <Text style={{ ...type.meta, color: color.fgSecondary }}>{mt.learnedIntro}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {traits.map((t) => (
                  <View key={JSON.stringify(t)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: `${color.friends}26`, justifyContent: 'center' }}>
                    <Text style={{ ...type.meta, fontFamily: font.bold, color: color.friends }}>{traitLabel(t)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={{ ...type.meta, color: color.fgSecondary }}>{mt.learnedNone}</Text>
          )}
        </View>
      </Group>
      <Group>
        <Row
          testID="ai-recent"
          title={mt.sRecent}
          sub={mt.sRecentSub}
          chevron={false}
          onPress={async () => {
            await clearRecent();
            toast(mt.recentCleared);
          }}
        />
      </Group>
      <Group>
        {confirm ? (
          <View style={{ padding: space.l, gap: space.m }}>
            <Text style={{ ...type.headline, color: color.fgPrimary }}>{mt.forgetAsk}</Text>
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Pressable accessibilityRole="button" onPress={() => setConfirm(false)} style={{ flex: 1, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...type.meta, fontFamily: font.bold, color: color.fgPrimary }}>{mt.forgetNo}</Text>
              </Pressable>
              <Pressable
                testID="ai-forget-yes"
                accessibilityRole="button"
                onPress={async () => {
                  await forget();
                  setTraits([]);
                  setConfirm(false);
                  toast(mt.forgotten);
                }}
                style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ ...type.meta, fontFamily: font.bold, color: color.fgPrimary }}>{mt.forgetYes}</Text>
              </Pressable>
            </View>
          </View>
) : (
          <Row testID="ai-forget" title={mt.sForget} sub={mt.sForgetSub} danger chevron={false} onPress={() => setConfirm(true)} />
        )}
      </Group>
    </Page>
  );
}

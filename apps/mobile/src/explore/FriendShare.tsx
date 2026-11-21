// #247 R-07.47: "Show me to friends" (S-30). Works at every level, made for Hidden.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as E from '../chat/engine';
import * as floc from '../chat/friendLoc';
import { friendTick } from '../chat/friendPerks';
import * as People from '../chat/people';
import { ppl } from '../i18n/people';
import { color, font, radius, space, type } from '../theme/tokens';
import { Icon } from '../ui';

export function FriendShare() {
  People.usePeople();
  const [mine, setMine] = useState<floc.Mine | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () => floc.mine().then((m) => setMine(m && m.until > Date.now() ? m : null));
    read();
    return floc.onMine(read);
  }, []);
  const n = People.friendList('yes').length;
  const on = !!mine;
  const start = async (h: number) => {
    setBusy(true);
    await floc.start(h);
    await friendTick(true).catch(() => {});
    setBusy(false);
  };
  const stop = async () => {
    setBusy(true);
    await E.stopLocShare().catch(() => {});
    setBusy(false);
  };
  return (
    <View testID="friend-share" style={{ gap: space.s, paddingVertical: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon.User size={18} c={color.friends} />
        <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary, flex: 1 }}>{ppl.showToFriends}</Text>
      </View>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>
        {n === 0 ? ppl.noFriendsShare : on ? ppl.sharingUntil(new Date(mine!.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), n) : ppl.showToFriendsSub}
      </Text>
      {n > 0 ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {on ? (
            <Pill testID="friend-share-stop" label={ppl.stopSharing} onPress={stop} disabled={busy} solid />
          ) : (
            floc.HOURS.map((h) => <Pill key={h} testID={`friend-share-${h}`} label={`${h} h`} onPress={() => start(h)} disabled={busy} />)
          )}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Icon.Lock size={11} c={color.trust} />
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted, flex: 1 }}>{ppl.shareLocal}</Text>
      </View>
    </View>
  );
}

function Pill({ label, onPress, disabled, solid, testID }: { label: string; onPress: () => void; disabled?: boolean; solid?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        { height: 40, paddingHorizontal: space.l, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: solid ? color.bgOverlay : 'transparent', borderWidth: solid ? 0 : 1.5, borderColor: color.friends },
        (pressed || disabled) && { opacity: 0.7 },
      ]}
    >
      <Text style={{ ...type.meta, fontFamily: font.heavy, color: color.fgPrimary }}>{label}</Text>
    </Pressable>
  );
}

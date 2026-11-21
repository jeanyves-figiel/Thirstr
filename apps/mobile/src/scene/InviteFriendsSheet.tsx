// #247 R-07.49: the host invites friends to his party; each invite goes E2EE in the 1:1 chat.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as E from '../chat/engine';
import * as People from '../chat/people';
import { ppl } from '../i18n/people';
import { tx } from '../i18n/app';
import { color, font, radius, space, type } from '../theme/tokens';
import { Button, Icon, Sheet } from '../ui';
import { toast } from '../ui/Toast';
import type { Party } from './types';

export const invitable = () =>
  People.friendList('yes')
    .map((peer) => ({ peer, name: E.convWith(peer)?.name ?? '' }))
    .filter((f) => !!f.name && !!E.convWith(f.peer));

export function InviteFriendsSheet({ party, visible, onClose }: { party: Party; visible: boolean; onClose: () => void }) {
  const list = invitable();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const picked = list.filter((f) => !off.has(f.peer));
  const all = picked.length === list.length;
  const flip = (peer: string) =>
    setOff((cur) => {
      const n = new Set(cur);
      if (n.has(peer)) n.delete(peer);
      else n.add(peer);
      return n;
    });
  const send = async () => {
    setBusy(true);
    const n = await E.sendPartyInvites(
      picked.map((f) => f.peer),
      { id: party.id, code: party.invite_code, title: party.title, starts_at: party.starts_at },
    ).catch(() => 0);
    setBusy(false);
    toast(n ? ppl.invited(n) : tx.common.error);
    if (n) onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={ppl.inviteFriends} closeLabel={tx.common.close}>
      <Pressable testID="invite-all" accessibilityRole="checkbox" accessibilityState={{ checked: all }} onPress={() => setOff(all ? new Set(list.map((f) => f.peer)) : new Set())} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Box on={all} />
        <Text style={{ ...type.headline, fontSize: 15, color: color.fgPrimary }}>{ppl.selectAll}</Text>
      </Pressable>
      {list.map((f) => (
        <Pressable key={f.peer} testID={`invite-${f.peer}`} accessibilityRole="checkbox" accessibilityState={{ checked: !off.has(f.peer) }} onPress={() => flip(f.peer)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
          <Box on={!off.has(f.peer)} />
          <Text style={{ ...type.meta, fontFamily: font.bold, fontSize: 15, color: color.fgPrimary, flex: 1 }}>{f.name}</Text>
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginVertical: space.s }}>
        <Icon.Lock size={11} c={color.trust} />
        <Text style={{ ...type.meta, fontSize: 12, color: color.fgMuted, flex: 1 }}>{ppl.inviteLocal}</Text>
      </View>
      <Button testID="invite-send" title={ppl.sendInvites(picked.length)} busy={busy} disabled={!picked.length} onPress={send} />
    </Sheet>
  );
}

function Box({ on }: { on: boolean }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.friends : 'transparent', borderWidth: on ? 0 : 2, borderColor: color.line }}>
      {on ? <Icon.Check size={13} c={color.onAccent} /> : null}
    </View>
  );
}

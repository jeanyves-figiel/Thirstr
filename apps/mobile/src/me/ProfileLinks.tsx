import React, { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Button, Chip, Chips, ErrorText, Field, ListRow, Section } from '../ui';
import { Qr } from './Qr';

type Linked = { id: string; platform: string; handle: string; visibility: string; verified: boolean; code?: string };
const PLATFORMS = ['bluesky', 'x', 'onlyfans', 'jff', 'instagram'];
const VIS = ['chats', 'verified', 'everyone'];

// I-01 linked accounts + I-02 share link, inside Edit profile.
export function ProfileLinks({ profileId }: { profileId: string }) {
  const [list, setList] = useState<Linked[]>([]);
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState('bluesky');
  const [handle, setHandle] = useState('');
  const [vis, setVis] = useState('chats');
  const [share, setShare] = useState<{ slug: string; url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ linked: Linked[] }>('GET', `/me/profiles/${profileId}/linked-accounts`).then((r) => setList(r.linked), () => {});
    api<{ share: { slug: string; url: string } | null }>('GET', `/me/profiles/${profileId}/share`).then((r) => setShare(r.share), () => {});
  }, [profileId]);
  useEffect(load, [load]);

  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? (Object.values(e.fields ?? {})[0]?.[0] ?? e.message) : tx.common.error);
    }
  };

  const add = () =>
    run(async () => {
      await api('POST', '/me/linked-accounts', { profile_id: profileId, platform, handle, visibility: vis });
      setAdding(false);
      setHandle('');
    });

  return (
    <View style={{ gap: space.l }}>
      <Text style={{ ...type.headline, color: color.fgPrimary }}>{tx.linked.title}</Text>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.linked.hint}</Text>
      {list.length ? (
        <Section>
          {list.map((l) => (
            <View key={l.id} testID={`linked-${l.platform}`} style={{ gap: space.xs, paddingVertical: space.xs }}>
              <ListRow title={`${tx.linked.platforms[l.platform]} · @${l.handle}`} sub={`${tx.linked.vis[l.visibility]} · ${l.verified ? tx.linked.proven : l.platform === 'bluesky' ? tx.linked.notProven : ''}`} />
              {l.code ? <Text style={{ ...type.meta, color: color.trust }}>{tx.linked.proveHint(l.code)}</Text> : null}
              <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
                {l.platform === 'bluesky' && !l.verified ? <Button small kind="secondary" title={tx.linked.check} onPress={() => run(() => api('POST', `/me/linked-accounts/${l.id}/verify`))} /> : null}
                {VIS.filter((v) => v !== l.visibility).map((v) => (
                  <Button key={v} small kind="ghost" title={tx.linked.vis[v]} onPress={() => run(() => api('PATCH', `/me/linked-accounts/${l.id}`, { visibility: v }))} />
                ))}
                <Button small kind="ghost" title={tx.linked.remove} onPress={() => run(() => api('DELETE', `/me/linked-accounts/${l.id}`))} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      {adding ? (
        <View style={{ gap: space.m }}>
          <Chips>
            {PLATFORMS.map((p) => (
              <Chip key={p} label={tx.linked.platforms[p]} on={platform === p} onPress={() => setPlatform(p)} />
            ))}
          </Chips>
          <Field testID="linked-handle" label={tx.linked.handle} value={handle} onChangeText={setHandle} autoCapitalize="none" maxLength={64} />
          <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.linked.visibility}</Text>
          <Chips>
            {VIS.map((v) => (
              <Chip key={v} label={tx.linked.vis[v]} on={vis === v} onPress={() => setVis(v)} />
            ))}
          </Chips>
          <Button testID="linked-save" title={tx.common.save} disabled={!handle.trim()} onPress={add} />
        </View>
      ) : list.length < 5 ? (
        <Button testID="linked-add" kind="secondary" title={tx.linked.add} onPress={() => setAdding(true)} />
      ) : null}

      <Text style={{ ...type.headline, color: color.fgPrimary }}>{tx.share.title}</Text>
      <Text style={{ ...type.meta, color: color.fgSecondary }}>{tx.share.hint}</Text>
      {share ? (
        <View style={{ alignItems: 'center', gap: space.m }}>
          <Qr value={share.url} size={180} />
          <Text testID="share-url" selectable style={{ ...type.body, color: color.trust }}>
            {share.url}
          </Text>
          <Button title={tx.share.send} onPress={() => Share.share({ message: share.url }).catch(() => {})} />
          <Button small kind="secondary" title={tx.share.rotate} onPress={() => run(() => api('POST', `/me/profiles/${profileId}/share`))} />
          <Button small kind="ghost" title={tx.share.off} onPress={() => run(() => api('DELETE', `/me/profiles/${profileId}/share`))} />
        </View>
      ) : (
        <Button testID="share-create" kind="secondary" title={tx.share.create} onPress={() => run(() => api('POST', `/me/profiles/${profileId}/share`))} />
      )}
      <ErrorText text={err} />
    </View>
  );
}

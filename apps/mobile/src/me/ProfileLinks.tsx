import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { tx } from '../i18n/app';
import { LinkedRow } from '../links/LinkedAccounts';
import { color, space, type } from '../theme/tokens';
import { Button, ErrorText } from '../ui';
import { Qr } from './Qr';

// I-01 linked accounts (row → S-63) + I-02 share link, inside Edit profile.
export function ProfileLinks({ profileId }: { profileId: string }) {
  const nav = useNavigation<{ navigate: (n: string, p?: object) => void }>();
  const [share, setShare] = useState<{ slug: string; url: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
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

  return (
    <View style={{ gap: space.l }}>
      {/* I-01 (#17): linked accounts have their own screen (S-63). */}
      <LinkedRow profileId={profileId} onOpen={() => nav.navigate('LinkedAccounts', { profileId })} />

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

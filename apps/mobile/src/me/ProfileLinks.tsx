import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { LinkedRow } from '../links/LinkedAccounts';

// I-01 linked accounts, inside Edit profile: one row that opens S-63 (#17).
// The I-02 share link lives in the Me Share sheet only (S-80, #8).
export function ProfileLinks({ profileId }: { profileId: string }) {
  const nav = useNavigation<{ navigate: (n: string, p?: object) => void }>();
  return <LinkedRow profileId={profileId} onOpen={() => nav.navigate('LinkedAccounts', { profileId })} />;
}

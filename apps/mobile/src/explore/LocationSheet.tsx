import React from 'react';
import { type Me, api } from '../api/client';
import { useSession } from '../app/session';
import { tx } from '../i18n/app';
import { Sheet, Toggle } from '../ui';
import { LocationControl } from './LocationControl';
import { FriendShare } from './FriendShare';

export { type Level, position, quickLevel } from './level';

// S-30 Location sheet (F-05), #190: the same LocationControl as Me (every tap applies, Exact panel
// inline, no Save, no second list of levels) + "Hide me from guys who are hidden" (R-05.6).
// Opened from Explore and Settings › Privacy.
export function LocationSheet({ visible, onClose, onLocked }: { visible: boolean; onClose: () => void; onLocked?: () => void }) {
  const { me, setMe } = useSession();
  return (
    <Sheet visible={visible} onClose={onClose} title={tx.location.title} closeLabel={tx.common.close}>
      <LocationControl testPrefix="sheet" onLocked={onLocked} />
      <Toggle
        label={tx.location.hideFromHidden}
        sub={tx.location.hideFromHiddenSub}
        value={!!me.location?.hide_from_hidden}
        onChange={(v) => api<Me>('PATCH', '/me/visibility', { hide_from_hidden: v }).then(setMe, () => {})}
      />
      <FriendShare />
    </Sheet>
  );
}

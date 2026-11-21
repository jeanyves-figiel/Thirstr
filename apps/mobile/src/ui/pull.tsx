// F-19 G6 (#187): pull to refresh, same look on every list (spinner in the current mode colour).
import React, { useCallback, useState } from 'react';
import { RefreshControl } from 'react-native';
import { useSession } from '../app/session';
import { color, modeColor } from '../theme/tokens';

export function usePull(load: () => unknown) {
  const { mode } = useSession();
  const [on, setOn] = useState(false);
  const refresh = useCallback(() => {
    setOn(true);
    Promise.resolve()
      .then(load)
      .catch(() => {})
      .finally(() => setOn(false));
  }, [load]);
  return <RefreshControl refreshing={on} onRefresh={refresh} tintColor={modeColor[mode]} colors={[modeColor[mode]]} progressBackgroundColor={color.bgRaised} />;
}

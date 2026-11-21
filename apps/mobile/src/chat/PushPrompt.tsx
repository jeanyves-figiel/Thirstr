import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import { tx } from '../i18n/app';
import { color, type } from '../theme/tokens';
import { Button, Sheet } from '../ui';
import { askPushPermission, on } from './engine';

const KEY = 'thirstr.pushAsked';

// R-16.7: pre-prompt on the first inbound event, explaining the content-free design, then the OS prompt.
export function PushPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    return on('incoming', () => {
      AsyncStorage.getItem(KEY).then((v) => {
        if (!v) setOpen(true);
      });
    });
  }, []);
  const close = () => {
    setOpen(false);
    AsyncStorage.setItem(KEY, '1');
  };
  return (
    <Sheet visible={open} onClose={close} title={tx.push.title} closeLabel={tx.common.close}>
      <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.push.body}</Text>
      <Button
        title={tx.push.allow}
        onPress={() => {
          close();
          askPushPermission();
        }}
      />
      <Button kind="ghost" title={tx.push.later} onPress={close} />
    </Sheet>
  );
}

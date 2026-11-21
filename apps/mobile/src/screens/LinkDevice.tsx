import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { api, ApiError, Me, platform, saveSession, Session } from '../api/client';
import * as X from '../chat/transfer';
import { tx } from '../i18n/app';
import { xx } from '../i18n/transfer';
import { color, space } from '../theme/tokens';
import { Body, Button, ErrorText, Field, H1, Screen } from '../ui';

// R-01.6 new device: scan the QR (or type the code) shown on the old phone, wait for its OK.
export function LinkDeviceScreen({ onDone, onBack }: { onDone: (me: Me) => void; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [scan, setScan] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [match, setMatch] = useState<string | null>(null);
  const [perm, askPerm] = useCameraPermissions();
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const go = async (raw: string) => {
    const c = raw.replace(/^thirstr:\/\/link\//, '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (c.length !== 8) return setErr(tx.devices.badCode);
    setErr(null);
    setScan(false);
    setWaiting(true);
    try {
      // R-01.14: one-time key for the chat transfer; both phones show the same 6-digit code.
      const keys = X.newKeys();
      const r = await api<{ claim: string; xfer_pub?: string | null }>('POST', '/auth/device-link', { code: c, platform, xfer_pub: keys.pub });
      if (r.xfer_pub) setMatch(X.matchCode(r.xfer_pub, keys.pub));
      for (let i = 0; i < 60 && alive.current; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const s = await api<Session | { state: string }>('POST', '/auth/device-link', { code: c, claim: r.claim });
        if ('access_token' in s) {
          if (r.xfer_pub) X.expect(keys, r.xfer_pub);
          return onDone(await saveSession(s));
        }
      }
      throw new Error('timeout');
    } catch (e) {
      setWaiting(false);
      setMatch(null);
      setErr(e instanceof ApiError && e.status !== 404 ? e.message : tx.devices.badCode);
    }
  };

  if (scan)
    return (
      <View style={{ flex: 1, backgroundColor: color.bgBase }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => go(data)} />
        <View style={{ padding: space.l }}>
          <Button kind="ghost" title={tx.common.back} onPress={() => setScan(false)} />
        </View>
      </View>
    );

  return (
    <Screen>
      <H1>{tx.devices.haveApp}</H1>
      <Body muted>{waiting ? tx.devices.waiting : tx.devices.enterHint}</Body>
      {waiting && match ? (
        <View style={{ gap: 2 }}>
          <Body muted>{xx.showsCode}</Body>
          <Text testID="link-match" style={{ fontSize: 28, fontWeight: '800', letterSpacing: 3, color: color.trust, fontVariant: ['tabular-nums'] }}>
            {match}
          </Text>
        </View>
      ) : null}
      {!waiting ? (
        <>
          {Platform.OS !== 'web' ? (
            <Button
              title={tx.devices.scan}
              kind="secondary"
              onPress={async () => {
                if (perm?.granted || (await askPerm()).granted) setScan(true);
              }}
            />
          ) : null}
          <Field testID="link-code-input" label={tx.devices.enterCode} value={code} onChangeText={setCode} autoCapitalize="characters" maxLength={9} />
          <ErrorText text={err} />
          <Button testID="link-send" title={tx.devices.send} disabled={code.replace(/[^0-9A-Za-z]/g, '').length !== 8} onPress={() => go(code)} />
        </>
      ) : null}
      <View style={{ flex: 1 }} />
      <Button kind="ghost" title={tx.common.back} onPress={onBack} />
    </Screen>
  );
}

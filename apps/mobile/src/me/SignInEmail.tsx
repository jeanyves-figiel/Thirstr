import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { tx } from '../i18n/app';
import { color, space, type } from '../theme/tokens';
import { Button, ErrorText, Field, Sheet } from '../ui';

const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * RF-7 (required-fields.md): optional sign-in email for Apple, Google and passkey accounts.
 * We send a link; tapping it adds the email. The address itself is never stored, only its hash.
 */
export function SignInEmailSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/me/email', { email: email.trim() });
      setSent(email.trim());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : tx.common.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={tx.signInEmail.title} closeLabel={tx.common.close}>
      <View style={{ gap: space.m, paddingBottom: space.xl }}>
        {sent ? (
          <Text testID="signin-email-sent" style={{ ...type.body, color: color.trust }}>
            {tx.signInEmail.sent(sent)}
          </Text>
        ) : (
          <>
            <Text style={{ ...type.body, color: color.fgSecondary }}>{tx.signInEmail.body}</Text>
            <Field testID="signin-email" label={tx.signInEmail.label} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" maxLength={254} />
            <ErrorText text={err} />
            <Button testID="signin-email-send" title={tx.signInEmail.send} busy={busy} disabled={!EMAIL.test(email.trim())} onPress={send} />
          </>
        )}
      </View>
    </Sheet>
  );
}

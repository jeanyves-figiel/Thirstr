import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ApiError, Me } from '../api/client';
import { authMethods, requestEmailLink, signInWith } from '../auth/oidc';
import { loginPasskey, passkeysAvailable, registerPasskey } from '../auth/passkey';
import { o } from '../i18n/onboarding';
import { t } from '../i18n/strings';
import { BackButton, BigButton, Enter, k, StepShell } from '../onboarding/kit';
import { rx } from '../i18n/recovery';
import { color, font, radius, space } from '../theme/tokens';
import { ErrorText, useKeyboardShown, Wordmark } from '../ui';

// S-02 v2 (F-01 R-01.1, R-01.12, F-02 R-02.1b): Apple first, passkey, Google, email link; 18+ by consent line.
export function CreateAccountScreen({ mode, onDone, onEmailSent, onUnderage, onBack, onRecover }: { mode: 'signup' | 'login'; onDone: (me: Me) => void; onEmailSent: (email: string, adult: boolean) => void; onUnderage: () => void; onBack?: () => void; onRecover?: () => void }) {
  const insets = useSafeAreaInsets();
  const kb = useKeyboardShown();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const signup = mode === 'signup';
  // Tapping a method under the consent line confirms 18+ (age_confirmed: true); S-03b still blocks under-18s.
  const adult = true;

  async function run(key: string, fn: () => Promise<Me | void>) {
    setErr(null);
    setBusy(key);
    try {
      const me = await fn();
      if (me) onDone(me);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'underage') return onUnderage();
      if ((e as Error).name === 'NotAllowedError' || (e as Error).message === 'cancelled') return; // sheet cancelled: stay
      setErr(e instanceof ApiError ? e.message : t.errors.generic);
    } finally {
      setBusy(null);
    }
  }

  return (
    // #134: the email field rides up with the keyboard instead of hiding behind it.
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[k.root, { paddingTop: insets.top + space.s, paddingBottom: (kb ? space.m : Math.max(insets.bottom, space.l)) + space.xs }]}>
      <View style={c.head}>
        {onBack ? <BackButton onPress={onBack} /> : <View style={{ width: 44 }} />}
        <Wordmark size={24} />
        <View style={{ width: 44 }} />
      </View>
      <Enter style={c.intro}>
        <Text style={c.title} accessibilityRole="header">
          {signup ? o.signup.title : o.signup.loginTitle}
        </Text>
        <Text style={k.sub}>{signup ? o.signup.sub : o.signup.loginSub}</Text>
      </Enter>
      <View style={{ flex: 1 }} />
      <Enter delay={120} style={c.methods}>
        {authMethods.apple ? (
          <MethodButton testID="apple" kind="white" icon={<AppleGlyph />} title={o.signup.apple} busy={busy === 'apple'} onPress={() => run('apple', () => signInWith('apple', adult))} />
        ) : null}
        {passkeysAvailable() ? (
          <MethodButton testID="passkey" icon={<KeyGlyph />} title={o.signup.passkey} busy={busy === 'pk'} onPress={() => run('pk', () => (signup ? registerPasskey(adult) : loginPasskey()))} />
        ) : null}
        {authMethods.google ? <MethodButton testID="google" icon={<Text style={c.g}>G</Text>} title={o.signup.google} busy={busy === 'google'} onPress={() => run('google', () => signInWith('google', adult))} /> : null}
        {!authMethods.email ? null : showEmail ? (
          <Enter style={{ gap: space.s }}>
            <TextInput
              testID="email"
              accessibilityLabel="Email"
              value={email}
              onChangeText={setEmail}
              placeholder={o.signup.emailPh}
              placeholderTextColor={color.fgMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
              selectionColor={color.hookup}
              style={c.email}
            />
            <BigButton title={o.signup.send} busy={busy === 'email'} disabled={!/^\S+@\S+\.\S+$/.test(email)} onPress={() => run('email', async () => { await requestEmailLink(email, adult); onEmailSent(email.trim(), adult); })} />
          </Enter>
        ) : (
          <MethodButton testID="email-start" kind="text" icon={<MailGlyph />} title={o.signup.email} onPress={() => setShowEmail(true)} />
        )}
        <ErrorText text={err} />
        {!signup && onRecover ? <BigButton kind="text" testID="recover-start" title={rx.lost} onPress={onRecover} /> : null}
        {signup ? (
          <Text style={c.consent}>
            {o.signup.consent[0]}
            <Text style={c.consentStrong}>{o.signup.consent[1]}</Text>
            {o.signup.consent[2]}
          </Text>
        ) : null}
      </Enter>
    </KeyboardAvoidingView>
  );
}

function MethodButton({ title, icon, onPress, busy, kind = 'raised', testID }: { title: string; icon: React.ReactNode; onPress: () => void; busy?: boolean; kind?: 'white' | 'raised' | 'text'; testID?: string }) {
  const bg = kind === 'white' ? color.bgInverse : kind === 'raised' ? color.bgRaised : 'transparent';
  const fg = kind === 'white' ? color.onAccent : color.fgPrimary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: !!busy }}
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [k.big, { minHeight: kind === 'text' ? 48 : 56, backgroundColor: bg }, pressed && k.pressed, busy && { opacity: 0.6 }]}
    >
      {icon}
      <Text style={{ fontFamily: kind === 'white' ? font.heavy : font.bold, fontSize: kind === 'text' ? 16 : 17, color: fg }}>{title}</Text>
    </Pressable>
  );
}

const AppleGlyph = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path
      fill={color.onAccent}
      d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8C6.9 7.4 5.4 8.4 4.6 9.9c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.4 2.9 2.4 1.2-.1 1.6-.8 3-.8s1.8.8 3 .8c1.3 0 2.1-1.2 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.4-.9-2.4-4.3zM14.1 5.8c.6-.8 1.1-1.8 1-2.8-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.3z"
    />
  </Svg>
);
const line = { fill: 'none', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const KeyGlyph = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Circle cx={8} cy={9} r={4} stroke={color.trust} {...line} />
    <Path d="M11 12l9 9M17 18l2-2M15 16l2-2" stroke={color.trust} {...line} />
  </Svg>
);
const MailGlyph = () => (
  <Svg width={18} height={18} viewBox="0 0 24 24">
    <Rect x={3} y={5} width={18} height={14} rx={2} stroke={color.fgPrimary} {...line} />
    <Path d="M3 7l9 6 9-6" stroke={color.fgPrimary} {...line} />
  </Svg>
);

// "Check your inbox": shows where the link went and lets the person resend after 30 s.
export function CheckInboxScreen({ email, adult, onBack }: { email: string; adult: boolean; onBack: () => void }) {
  const [wait, setWait] = useState(30);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  const resend = async () => {
    setBusy(true);
    setNote(null);
    try {
      await requestEmailLink(email, adult);
      setNote(t.inbox.resent);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : t.verify.error);
    } finally {
      setBusy(false);
      setWait(30);
    }
  };
  return (
    <StepShell
      onBack={onBack}
      title={t.inbox.title}
      sub={t.inbox.body}
      cta={{ title: wait > 0 ? t.inbox.resendIn(wait) : t.inbox.resend, testID: 'inbox-resend', disabled: wait > 0, busy, onPress: resend }}
      below={<BigButton kind="text" title={t.inbox.back} onPress={onBack} />}
    >
      <View style={c.sentCard}>
        <View style={c.mailBadge}>
          <MailGlyph />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={k.sub}>{t.inbox.sentTo}</Text>
          <Text testID="inbox-email" numberOfLines={1} style={c.sentEmail}>{email}</Text>
        </View>
      </View>
      {note ? <Text style={[k.sub, { color: color.trust }]}>{note}</Text> : null}
      {__DEV__ || process.env.EXPO_PUBLIC_ENV === 'dev' ? <Text style={k.sub}>{t.inbox.devHint}</Text> : null}
    </StepShell>
  );
}

const c = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l },
  intro: { marginTop: 64, paddingHorizontal: space.xxl, gap: space.m },
  title: { fontFamily: font.heavy, fontSize: 38, lineHeight: 42, letterSpacing: -1.1, color: color.fgPrimary },
  methods: { paddingHorizontal: space.xxl, gap: 10 },
  g: { fontFamily: font.heavy, fontSize: 19, color: color.fgPrimary },
  email: { minHeight: 56, borderRadius: radius.pill, borderWidth: 2, borderColor: color.line, backgroundColor: color.bgRaised, color: color.fgPrimary, fontFamily: font.regular, fontSize: 17, paddingHorizontal: 22 },
  consent: { marginTop: space.s, marginHorizontal: space.s, fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.fgMuted, textAlign: 'center' },
  consentStrong: { fontFamily: font.bold, color: color.fgPrimary },
  mailBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.bgBase, alignItems: 'center', justifyContent: 'center' },
  sentCard: { marginTop: space.xl, flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m, borderRadius: 24, backgroundColor: color.bgRaised },
  sentEmail: { fontFamily: font.bold, fontSize: 17, color: color.fgPrimary },
});

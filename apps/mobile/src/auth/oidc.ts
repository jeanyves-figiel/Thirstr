import { Platform } from 'react-native';
import { api, platform, saveSession, Session } from '../api/client';
import { googleIdToken } from './google';

// Which sign-in methods this build offers (S-02). DEV (web, EXPO_PUBLIC_ENV=dev) uses the
// server's dev issuer for Apple/Google. Native iOS uses the real Sign in with Apple sheet.
// Google: native on iOS (#25, I-03); elsewhere opt-in per build. Email link needs SMTP (#26).
const devAuth = process.env.EXPO_PUBLIC_ENV === 'dev';
const flag = (v: string | undefined) => v === '1' || v === 'true';

export const authMethods = {
  apple: devAuth || Platform.OS === 'ios',
  google: devAuth || Platform.OS === 'ios' || flag(process.env.EXPO_PUBLIC_AUTH_GOOGLE),
  email: devAuth || Platform.OS === 'web' || flag(process.env.EXPO_PUBLIC_AUTH_EMAIL),
};

// Sign in with Apple / Google. Native SDK flows hand us an ID token; on DEV the
// server's dev issuer mints one so the full server path is exercised on localhost.
export async function signInWith(provider: 'apple' | 'google', ageConfirmed: boolean) {
  const id_token = devAuth ? await devToken(provider) : await nativeToken(provider);
  const s = await api<Session>('POST', '/auth/oidc', { provider, id_token, age_confirmed: ageConfirmed, platform });
  return saveSession(s);
}

async function devToken(provider: string) {
  const sub = await devSubject(provider);
  const { id_token } = await api<{ id_token: string }>('POST', '/dev/oidc/token', { sub });
  return id_token;
}

async function nativeToken(provider: 'apple' | 'google') {
  if (Platform.OS !== 'ios') throw new Error('unsupported');
  if (provider === 'google') return googleIdToken();
  const Apple = await import('expo-apple-authentication');
  try {
    // No scopes: we never ask Apple for name or email (R-01.2).
    const cred = await Apple.signInAsync({ requestedScopes: [] });
    if (!cred.identityToken) throw new Error('cancelled');
    return cred.identityToken;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new Error('cancelled');
    throw e;
  }
}

// Stable per-install fake subject so "sign in again" finds the same DEV account.
async function devSubject(provider: string) {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  const key = 'thirstr.dev.oidc.' + provider;
  let sub = await AsyncStorage.getItem(key);
  if (!sub) {
    sub = provider + '-dev-' + Math.random().toString(36).slice(2, 10);
    await AsyncStorage.setItem(key, sub);
  }
  return sub;
}

export async function requestEmailLink(email: string, ageConfirmed: boolean) {
  await api('POST', '/auth/email/link', { email, age_confirmed: ageConfirmed });
}

export async function verifyEmailToken(token: string) {
  const s = await api<Session>('POST', '/auth/email/verify', { token, platform });
  return saveSession(s);
}

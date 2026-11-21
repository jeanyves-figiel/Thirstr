import {
  BricolageGrotesque_400Regular,
  BricolageGrotesque_500Medium,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/bricolage-grotesque';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { ActivityIndicator, AppState, Dimensions, Platform, View } from 'react-native';
import { api, ApiError, clearSession, hasSession, Me } from './src/api/client';
import { verifyEmailToken } from './src/auth/oidc';
import { screenFor, Screen as S } from './src/onboarding/flow';
import { BasicsScreen, UnderageScreen } from './src/screens/Basics';
import { CheckInboxScreen, CreateAccountScreen } from './src/screens/CreateAccount';
import { Main } from './src/app/Main';
import { SessionProvider } from './src/app/session';
import { LocationScreen } from './src/screens/Location';
import { PhotoScreen } from './src/screens/Photo';
import { VerifyScreen } from './src/screens/Verify';
import { LinkDeviceScreen } from './src/screens/LinkDevice';
import { RecoveredScreen, RecoverSignInScreen } from './src/screens/RecoverSignIn';
import type { Restored } from './src/auth/recovery';
import { WelcomeScreen } from './src/screens/Welcome';
import { DoneScreen } from './src/screens/Done';
import { color } from './src/theme/tokens';
import { StartupGuard } from './src/app/StartupGuard';
import { loadCached, refreshConfig, useAppConfig } from './src/app/config';
import { UpdateRequiredScreen } from './src/screens/UpdateRequired';
import { installCrashReporter } from './src/app/crash';

installCrashReporter();

// SafeAreaProvider draws nothing until native reports the insets; if that report never
// comes the whole app stays blank. Start from known metrics so it always draws (#88).
const startMetrics: Metrics = initialWindowMetrics ?? {
  frame: { x: 0, y: 0, ...Dimensions.get('window') },
  insets: { top: Platform.OS === 'ios' ? 47 : 0, bottom: Platform.OS === 'ios' ? 34 : 0, left: 0, right: 0 },
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [screen, setScreen] = useState<S | 'loading' | 'recover' | 'recovered'>('loading');
  const [restored, setRestored] = useState<Restored | null>(null);
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [sent, setSent] = useState<{ email: string; adult: boolean }>({ email: '', adult: true });
  const [fontsLoaded, fontsError] = useFonts({ BricolageGrotesque_400Regular, BricolageGrotesque_500Medium, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold });

  // Never block on fonts: if they fail or hang, fall back to the system font (blank-screen fix).
  const [fontsTimedOut, setFontsTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontsTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontsError || fontsTimedOut;

  // EN-13/EN-14: flags + minimum build, at start and on every return to the foreground.
  const appConfig = useAppConfig();
  useEffect(() => {
    loadCached().then(() => refreshConfig());
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshConfig());
    return () => sub.remove();
  }, []);

  const land = (m: Me) => {
    setMe(m);
    setScreen(screenFor(m));
  };

  // Resume at the last incomplete step (F-02 edge case) or consume an email magic link.
  // Startup must always end on a screen: every step has a time limit and a failing
  // keychain or network falls through to Welcome instead of spinning forever (#90).
  useEffect(() => {
    (async () => {
      try {
        const token = Platform.OS === 'web' ? new URLSearchParams(window.location.search).get('token') : null;
        if (token) {
          window.history.replaceState({}, '', '/');
          return land(await withTimeout(verifyEmailToken(token), 15000));
        }
        if (await withTimeout(hasSession(), 5000)) return land(await withTimeout(api<Me>('GET', '/me', undefined, true, 10000), 15000));
      } catch (e) {
        console.warn('Startup session check failed', e);
        if (e instanceof ApiError && e.status === 401) await clearSession().catch(() => {});
      }
      setScreen('welcome');
    })();
  }, []);

  const signedOut = () => {
    setMe(null);
    setScreen('welcome');
  };

  let body: React.ReactNode;
  if (appConfig.upgradeRequired) body = <UpdateRequiredScreen storeUrl={appConfig.storeUrl} />;
  else switch (screen) {
    case 'loading':
      body = <ActivityIndicator style={{ flex: 1 }} color={color.hookup} />;
      break;
    case 'recover':
      body = <RecoverSignInScreen onBack={() => setScreen('create')} onDone={(m, r) => { setMe(m); setRestored(r); setScreen('recovered'); }} />;
      break;
    case 'recovered':
      body = <RecoveredScreen me={me!} restored={restored} onDone={() => land(me!)} />;
      break;
    case 'welcome':
      body = <WelcomeScreen onStart={() => { setMode('signup'); setScreen('create'); }} onLogin={() => { setMode('login'); setScreen('create'); }} onLink={() => setScreen('link')} />;
      break;
    case 'link':
      body = <LinkDeviceScreen onDone={land} onBack={() => setScreen('welcome')} />;
      break;
    case 'create':
      body = <CreateAccountScreen mode={mode} onBack={() => setScreen('welcome')} onDone={land} onEmailSent={(email, adult) => { setSent({ email, adult }); setScreen('inbox'); }} onUnderage={() => setScreen('underage')} onRecover={() => setScreen('recover')} />;
      break;
    case 'inbox':
      body = <CheckInboxScreen email={sent.email} adult={sent.adult} onBack={() => setScreen('create')} />;
      break;
    case 'basics':
      body = <BasicsScreen me={me!} onDone={land} onUnderage={async () => { await clearSession(); setScreen('underage'); }} />;
      break;
    case 'underage':
      body = <UnderageScreen />;
      break;
    case 'location':
      body = <LocationScreen me={me!} onDone={land} />;
      break;
    case 'photo':
      body = <PhotoScreen me={me!} onDone={land} />;
      break;
    case 'verify':
      // S-07 once, right after the last onboarding step (R-02.1g).
      body = <VerifyScreen onDone={(m) => { setMe(m); setScreen('done'); }} />;
      break;
    case 'done':
      body = <DoneScreen me={me!} onContinue={() => setScreen(screenFor(me))} />;
      break;
    default:
      body = (
        <SessionProvider me={me!} onSignedOut={signedOut}>
          <Main />
        </SessionProvider>
      );
  }

  return (
    // F-19 (#187): one gesture root for the whole app (UI-thread gestures).
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider initialMetrics={startMetrics}>
      <View style={{ flex: 1, backgroundColor: color.bgBase }}>
        <StatusBar style="light" />
        <StartupGuard>{fontsReady ? body : <ActivityIndicator style={{ flex: 1 }} color={color.hookup} />}</StartupGuard>
      </View>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

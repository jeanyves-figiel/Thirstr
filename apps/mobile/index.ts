import { registerRootComponent } from 'expo';
import { createElement, useEffect, useState, type ComponentType } from 'react';
import { ErrorView } from './src/app/StartupGuard';

// Errors outside React (module init, fatal async errors) would otherwise leave a blank
// screen in a release build. Catch them and show the message instead (#88).
let bootError: unknown = null;
const listeners = new Set<(e: unknown) => void>();
const report = (e: unknown) => {
  bootError = e ?? new Error('Unknown startup error');
  listeners.forEach((l) => l(bootError));
};

type Handler = (e: unknown, isFatal?: boolean) => void;
const EU = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => Handler; setGlobalHandler?: (h: Handler) => void } }).ErrorUtils;
if (EU?.setGlobalHandler) {
  const prev = EU.getGlobalHandler?.();
  EU.setGlobalHandler((e, isFatal) => (isFatal ? report(e) : prev?.(e, isFatal)));
}

let App: ComponentType = () => null;
try {
  // Crypto setup must run before anything that touches crypto.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./src/crypto/setup');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  App = require('./App').default;
} catch (e) {
  report(e);
}

function Root() {
  const [err, setErr] = useState<unknown>(bootError);
  useEffect(() => {
    const l = (e: unknown) => setErr(() => e);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return err ? createElement(ErrorView, { error: err }) : createElement(App);
}

registerRootComponent(Root);

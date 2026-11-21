// #25 / #168 device attestation (security.md › Device attestation, I-03).
// iOS App Attest: once per install a Secure Enclave key → Apple attests it → server stores the
// public key; then at most once a day an assertion over a fresh server challenge.
// Android Play Integrity (standard request): at most once a day a Google Play verdict whose
// request hash is the server challenge. Needs EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER at build.
// Soft in beta: failures are silent and retried later; nothing blocks, except that verification
// needs `proveAction` (#270).
// Data/energy: one GET + two small POSTs per day, only while the app is in the foreground.
import { sha256 } from '@noble/hashes/sha2.js';
import { Platform } from 'react-native';
import { api, ApiError } from '../api/client';
import { toB64url, utf8 } from '../chat/bytes';
import { kv } from '../chat/kv';

const K = 'attest';
const DAY = 24 * 3600_000;
const RETRY = 6 * 3600_000;
type State = { keyId?: string; next: number };

let running: Promise<void> | null = null;
let providerReady: Promise<void> | null = null;

function mod() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@expo/app-integrity') as typeof import('@expo/app-integrity');
}

const cloudProject = () => process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER || '';

export function attestSupported(): boolean {
  try {
    if (Platform.OS === 'ios') return mod().isSupported;
    if (Platform.OS === 'android') return cloudProject() !== '' && typeof mod().requestIntegrityCheckAsync === 'function';
  } catch {
    // module missing (web, tests)
  }
  return false;
}

/** Single-flight; returns at once when nothing is due. `force` ignores the daily schedule. */
export function ensureAttested(now = Date.now(), force = false): Promise<void> {
  if (!attestSupported()) return Promise.resolve();
  running ??= run(now, force).finally(() => (running = null));
  return running;
}

async function playToken(requestHash: string): Promise<string> {
  const AI = mod();
  providerReady ??= AI.prepareIntegrityTokenProviderAsync(cloudProject()).catch((e) => {
    providerReady = null;
    throw e;
  });
  await providerReady;
  return AI.requestIntegrityCheckAsync(requestHash);
}

async function run(now: number, force: boolean) {
  const st = (await kv.get<State>(K)) ?? { next: 0 };
  if (!force && st.next > now) return;
  try {
    if (Platform.OS === 'android') {
      const { challenge } = await api<{ challenge: string }>('POST', '/devices/attest/challenge');
      const token = await playToken(challenge);
      await api('POST', '/devices/attest', { platform: 'android', token, challenge });
      await kv.set(K, { next: now + DAY });
      return;
    }
    const AI = mod();
    const server = await api<{ attested: boolean; has_key: boolean }>('GET', '/devices/attest');
    let keyId = server.has_key ? st.keyId : undefined;
    if (keyId) {
      const { challenge } = await api<{ challenge: string }>('POST', '/devices/attest/challenge');
      try {
        const assertion = await AI.generateAssertionAsync(keyId, challenge);
        await api('POST', '/devices/assert', { assertion, challenge });
      } catch (e) {
        // key gone (reinstall restore, server wiped it) → make a new one now
        if (e instanceof ApiError && e.status >= 500) throw e;
        keyId = undefined;
      }
    }
    if (!keyId) {
      keyId = await AI.generateKeyAsync();
      const { challenge } = await api<{ challenge: string }>('POST', '/devices/attest/challenge');
      const attestation = await AI.attestKeyAsync(keyId, challenge);
      await api('POST', '/devices/attest', { key_id: keyId, attestation, challenge });
    }
    await kv.set(K, { keyId, next: now + DAY });
  } catch {
    await kv.set(K, { keyId: st.keyId, next: now + RETRY });
  }
}

/**
 * #270: proof that this genuine app on this phone makes one specific request. `clientData` is the
 * exact string the server rebuilds (verification: `"<nonce>.<blinded>"`). iOS: App Attest
 * assertion with the attested key (attests first if needed). Android: Play Integrity token with
 * request hash = base64url(SHA-256(clientData)). Empty object when the platform can't attest.
 */
export async function proveAction(clientData: string): Promise<{ assertion?: string; integrity_token?: string }> {
  if (!attestSupported()) return {};
  if (Platform.OS === 'android') return { integrity_token: await playToken(toB64url(sha256(utf8(clientData)))) };
  // Fresh check first (one GET + assert): the server may have dropped the key since the last day.
  await ensureAttested(Date.now(), true);
  const st = await kv.get<State>(K);
  if (!st?.keyId) return {};
  return { assertion: await mod().generateAssertionAsync(st.keyId, clientData) };
}

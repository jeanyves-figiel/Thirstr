// #25 device attestation (security.md › Device attestation, I-03): iOS App Attest.
// Once per install: Secure Enclave key → Apple attests it → server stores the public key.
// Then at most once a day: an assertion over a fresh server challenge proves the same app on the
// same device is still talking. Soft in beta: failures are silent and retried later; nothing blocks.
// Data/energy: one GET + two small POSTs per day, only while the app is in the foreground.
import { Platform } from 'react-native';
import { api, ApiError } from '../api/client';
import { kv } from '../chat/kv';

const K = 'attest';
const DAY = 24 * 3600_000;
const RETRY = 6 * 3600_000;
type State = { keyId?: string; next: number };

let running: Promise<void> | null = null;

function mod() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@expo/app-integrity') as typeof import('@expo/app-integrity');
}

export function attestSupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return mod().isSupported;
  } catch {
    return false;
  }
}

/** Single-flight; returns at once when nothing is due. */
export function ensureAttested(now = Date.now()): Promise<void> {
  if (!attestSupported()) return Promise.resolve();
  running ??= run(now).finally(() => (running = null));
  return running;
}

async function run(now: number) {
  const st = (await kv.get<State>(K)) ?? { next: 0 };
  if (st.next > now) return;
  const AI = mod();
  try {
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

import { describe, expect, it, jest } from '@jest/globals';
import { sha256 } from '@noble/hashes/sha2.js';
import { toB64url, utf8 } from '../src/chat/bytes';

// #168 Play Integrity client (standard request): daily verdict bound to the server challenge;
// #270 verification proof bound to "<nonce>.<blinded>".
const mockStore = new Map<string, unknown>();
const mockBodies: Record<string, unknown>[] = [];
const mockHashes: string[] = [];
let mockPrepared = 0;
const mockProjects: string[] = [];
process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER = '123456789';
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../src/chat/kv', () => ({
  kv: { get: async (k: string) => mockStore.get(k) ?? null, set: async (k: string, v: unknown) => void mockStore.set(k, v) },
}));
jest.mock('../src/api/client', () => ({
  ApiError: class extends Error {},
  api: async (_m: string, path: string, body?: Record<string, unknown>) => {
    if (path === '/devices/attest/challenge') return { challenge: 'c'.repeat(43) };
    if (body) mockBodies.push(body);
    return { attested: true };
  },
}));
jest.mock('@expo/app-integrity', () => ({
  isSupported: false,
  prepareIntegrityTokenProviderAsync: async (n: string) => {
    mockProjects.push(n);
    mockPrepared++;
  },
  requestIntegrityCheckAsync: async (h: string) => {
    mockHashes.push(h);
    return `token-for-${h}`;
  },
}));

import { attestSupported, ensureAttested, proveAction } from '../src/auth/attest';

describe('#168 Play Integrity client', () => {
  it('attests daily with the challenge as request hash; provider prepared once', async () => {
    expect(attestSupported()).toBe(true);
    const t0 = Date.parse('2026-11-21T20:00:00Z');
    await ensureAttested(t0);
    expect(mockBodies[0]).toEqual({ platform: 'android', token: `token-for-${'c'.repeat(43)}`, challenge: 'c'.repeat(43) });
    await ensureAttested(t0 + 3600_000);
    expect(mockBodies).toHaveLength(1);
    await ensureAttested(t0 + 25 * 3600_000);
    expect(mockBodies).toHaveLength(2);
    expect(mockPrepared).toBe(1);
    expect(mockProjects).toEqual(['123456789']);
  });

  it('#270 proveAction hashes the client data like the server', async () => {
    const want = toB64url(sha256(utf8('nonce.blinded')));
    expect(await proveAction('nonce.blinded')).toEqual({ integrity_token: `token-for-${want}` });
    expect(mockHashes.at(-1)).toBe(want);
  });
});

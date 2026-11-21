import { describe, expect, it, jest } from '@jest/globals';

// #25 App Attest client: attest once, assert at most daily, new key when the assertion is refused.
const mockStore = new Map<string, unknown>();
const mockCalls: string[] = [];
const mockBodies: unknown[] = [];
let mockServer = { attested: false, has_key: false };
let mockRefuse = false;
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../src/chat/kv', () => ({
  kv: { get: async (k: string) => mockStore.get(k) ?? null, set: async (k: string, v: unknown) => void mockStore.set(k, v) },
}));
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(st: number, code: string) {
      super(code);
      this.status = st;
    }
  }
  return {
    ApiError,
    api: async (m: string, path: string, body?: Record<string, unknown>) => {
      mockCalls.push(`${m} ${path}`);
      if (path === '/devices/attest' && m === 'GET') return mockServer;
      if (path === '/devices/attest/challenge') return { challenge: 'c'.repeat(43) };
      if (path === '/devices/assert' && mockRefuse) throw new ApiError(422, 'assertion_invalid');
      if (path === '/devices/attest') {
        mockBodies.push(body);
        mockServer = { attested: true, has_key: true };
      }
      return { attested: true };
    },
  };
});
jest.mock('@expo/app-integrity', () => ({
  isSupported: true,
  generateKeyAsync: async () => 'key-1',
  attestKeyAsync: async () => 'att',
  generateAssertionAsync: async () => 'assertion',
}));

import { ensureAttested } from '../src/auth/attest';

describe('#25 App Attest client', () => {
  it('attests once, then asserts at most daily, re-attests when refused', async () => {
    const t0 = Date.parse('2026-11-21T16:00:00Z');
    await ensureAttested(t0);
    expect(mockCalls).toEqual(['GET /devices/attest', 'POST /devices/attest/challenge', 'POST /devices/attest']);
    expect(mockBodies[0]).toEqual({ key_id: 'key-1', attestation: 'att', challenge: 'c'.repeat(43) });

    mockCalls.length = 0;
    await ensureAttested(t0 + 3600_000);
    expect(mockCalls).toEqual([]);

    await ensureAttested(t0 + 25 * 3600_000);
    expect(mockCalls).toEqual(['GET /devices/attest', 'POST /devices/attest/challenge', 'POST /devices/assert']);

    mockCalls.length = 0;
    mockRefuse = true;
    await ensureAttested(t0 + 50 * 3600_000);
    expect(mockCalls).toEqual(['GET /devices/attest', 'POST /devices/attest/challenge', 'POST /devices/assert', 'POST /devices/attest/challenge', 'POST /devices/attest']);
  });
});

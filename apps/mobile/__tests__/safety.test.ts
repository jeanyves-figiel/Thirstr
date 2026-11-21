import { describe, expect, it, jest } from '@jest/globals';
import { rand, toB64url } from '../src/chat/bytes';
import * as S from '../src/safety/safety';

jest.mock('../src/chat/kv', () => ({ kv: { get: async () => null, set: async () => {}, del: async () => {}, keys: async () => [], wipe: async () => {} } }));
jest.mock('../src/explore/location', () => ({ currentPosition: async () => null }));
jest.mock('../src/api/client', () => ({ api: async () => ({}) }));

describe('F-13 safety envelope', () => {
  it('seals with the contact key; only that key opens it', async () => {
    const key = toB64url(rand(32));
    const wire = await S.seal(key, { k: 'alert', from: 'Alex', at: '2026-11-17T20:00:00Z', loc: { lat: 47.37, lng: 8.54, at: '2026-11-17T20:00:00Z' } });
    expect(wire).not.toContain('Alex');
    expect((await S.open(key, wire)).loc?.lat).toBe(47.37);
    await expect(S.open(toB64url(rand(32)), wire)).rejects.toBeTruthy();
  });

  it('picks the local emergency number', async () => {
    expect(S.emergencyNumber('CH')).toBe('112');
    expect(S.emergencyNumber('US')).toBe('911');
    expect(S.emergencyNumber('GB')).toBe('999');
    expect(S.emergencyNumber(null)).toBe('112');
  });
});

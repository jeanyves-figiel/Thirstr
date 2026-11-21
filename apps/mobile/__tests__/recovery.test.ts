import { describe, expect, it, jest } from '@jest/globals';
import { ed25519 } from '@noble/curves/ed25519.js';

// F-01 R-01.7 (#25): words → keys, quiz, sealed backup round trip, sign-in restores the backup.
const mockStore = new Map<string, unknown>();
const mockSecure = new Map<string, string>();
const mockReq: { m: string; path: string; body?: Record<string, unknown> }[] = [];
let mockVault: string | null = null;
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock('../src/chat/kv', () => ({
  kv: {
    get: async (k: string) => mockStore.get(k) ?? null,
    set: async (k: string, v: unknown) => void (v === null ? mockStore.delete(k) : mockStore.set(k, v)),
    keys: async (p: string) => [...mockStore.keys()].filter((k) => k.startsWith(p)),
  },
}));
jest.mock('../src/api/client', () => ({
  platform: 'ios',
  saveSession: async (s: { account: unknown }) => s.account,
  api: async (m: string, path: string, body?: Record<string, unknown>) => {
    mockReq.push({ m, path, body });
    if (path === '/me/recovery/vault' && m === 'PUT') mockVault = body!.vault as string;
    if (path === '/me/recovery/vault' && m === 'GET') return { vault: mockVault, updated_at: '2026-11-21T03:12:00Z' };
    if (path === '/auth/recovery/options') return { challenge_id: 'cid', challenge: 'abc' };
    if (path === '/auth/recovery') return { account: { status: 'active' } };
    return {};
  },
}));

import * as R from '../src/auth/recovery';

const WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ');

describe('#25 recovery phrase (R-01.7)', () => {
  it('makes 12 valid words and derives stable, separate keys', () => {
    const w = R.newWords();
    expect(w).toHaveLength(12);
    expect(R.valid(w)).toBe(true);
    expect(R.valid(WORDS)).toBe(true);
    expect(R.valid([...WORDS.slice(0, 11), 'zoo'])).toBe(false);
    const a = R.deriveKeys(WORDS);
    const b = R.deriveKeys(WORDS.map((x) => ' ' + x.toUpperCase()));
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.vaultKey).not.toEqual(a.secretKey);
    expect(a.publicKey).toHaveLength(32);
  });

  it('quiz asks 3 distinct positions with the right word among 4', () => {
    const q = R.quiz(WORDS);
    expect(new Set(q.map((x) => x.pos)).size).toBe(3);
    for (const x of q) {
      expect(x.choices).toHaveLength(4);
      expect(x.choices).toContain(WORDS[x.pos]);
    }
    expect(R.suggest('wi')).toEqual(['wide', 'width', 'wife']);
    expect(R.isWord('winner')).toBe(true);
  });

  it('seals and opens; wrong key fails', () => {
    const k = R.deriveKeys(WORDS).vaultKey;
    const box = R.seal(k, { a: 1 });
    expect(R.open(k, box)).toEqual({ a: 1 });
    expect(() => R.open(R.deriveKeys(R.newWords()).vaultKey, box)).toThrow();
  });

  it('turn on uploads the key and a backup; sign in restores albums, notes, favorites', async () => {
    mockStore.set('albums', [{ id: 'a1', name: 'Beach', items: [], shares: [] }]);
    mockStore.set('note:p9', 'gym guy');
    mockStore.set('favs', { p9: true });
    await R.turnOn(WORDS);
    const put = mockReq.find((r) => r.path === '/me/recovery')!;
    expect(put.body!.public_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mockVault).toBeTruthy();
    expect(JSON.stringify(mockReq)).not.toContain('winner');

    // within the hour and unchanged: no upload
    expect(await R.backupNow()).toBe(false);

    mockStore.clear();
    mockSecure.clear();
    const { restored } = await R.signInWithWords(WORDS);
    const signin = mockReq.find((r) => r.path === '/auth/recovery')!;
    const pub = R.deriveKeys(WORDS).publicKey;
    const sig = Uint8Array.from(atob((signin.body!.signature as string).replace(/-/g, '+').replace(/_/g, '/') + '=='), (c) => c.charCodeAt(0));
    expect(ed25519.verify(sig, new TextEncoder().encode('thirstr-recovery:abc'), pub)).toBe(true);
    expect(restored).toMatchObject({ albums: 1, notes: 1, favorites: 1 });
    expect(mockStore.get('note:p9')).toBe('gym guy');
    expect(mockSecure.size).toBe(1);
  });
});

describe('sign-in word checks', () => {
  it('flags the first word not on the list, then a bad checksum', () => {
    const w = R.newWords();
    expect(R.wordsProblem(w)).toBeNull();
    expect(R.wordsProblem(Array(12).fill(''))).toBeNull();
    const bad = [...w];
    bad[3] = 'zzzz';
    expect(R.wordsProblem(bad)).toEqual({ notWord: 4 });
    // 'abandon' x12 has a wrong checksum
    expect(R.wordsProblem(Array(12).fill('abandon'))).toBe('checksum');
  });
});

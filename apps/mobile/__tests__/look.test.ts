import { describe, expect, it } from '@jest/globals';
import type { MyProfile } from '../src/api/types';
import { cycle, whatTheyMiss } from '../src/me/look';

// #114 S-66 "What X doesn't see" (F-06 R-06.7a).
const p = {
  id: 'p1',
  show_in: ['hookup', 'friends'],
  fields: { bio: 'hi', position: 'vers', hosting: 'can', hiv: 'neg', languages: ['fr'], tribes: [] },
  visibility_map: { position: 'verified', hosting: 'verified', hiv: 'chats', languages: 'public' },
  photos: [
    { id: 'a', slot: 0, status: 'approved', reject_reason: null, url: 'u0' },
    { id: 'b', slot: 1, status: 'approved', reject_reason: null, url: 'u1', main_ok: false },
    { id: 'c', slot: 2, status: 'approved', reject_reason: null, url: 'u2', main_ok: true },
    { id: 'd', slot: 3, status: 'rejected', reject_reason: 'x', url: 'u3', main_ok: false },
  ],
} as unknown as MyProfile;

const kinds = (m: ReturnType<typeof whatTheyMiss>) => m.map((x) => x.kind);

describe('whatTheyMiss', () => {
  it('Hookup stranger: verified-only and chats-only fields, albums', () => {
    const m = whatTheyMiss(p, 'stranger', 'hookup');
    expect(kinds(m)).toEqual(['verified', 'chats', 'albums']);
    expect(m[0].keys).toEqual(['position', 'hosting']);
    expect(m[1].keys).toEqual(['hiv']);
  });

  it('Hookup in chats: only albums', () => {
    expect(kinds(whatTheyMiss(p, 'chats', 'hookup'))).toEqual(['albums']);
  });

  it('Friends: spicy photos (rejected ignored) and hookup fields counted once by lens', () => {
    const m = whatTheyMiss(p, 'stranger', 'friends');
    expect(kinds(m)).toEqual(['photos', 'lens', 'albums']);
    expect(m[0].count).toBe(1);
    expect(m[1].keys).toEqual(['position', 'hosting', 'hiv']);
  });

  it('skips empty fields; only_me always listed', () => {
    const q = { ...p, fields: { bio: 'x', build: 'slim' }, visibility_map: { build: 'only_me' } } as unknown as MyProfile;
    const m = whatTheyMiss(q, 'chats', 'hookup');
    expect(kinds(m)).toEqual(['only_me', 'albums']);
  });

  it('local "My chats" values are included', () => {
    const q = { ...p, fields: {}, visibility_map: { prep: 'chats' } } as unknown as MyProfile;
    expect(kinds(whatTheyMiss(q, 'verified', 'hookup', { prep: 'on' }))).toEqual(['chats', 'albums']);
  });

  it('cycle wraps', () => {
    expect(cycle(['a', 'b', 'c'], 'c')).toBe('a');
  });
});

import { describe, expect, it } from '@jest/globals';
import { MATCH_AT, ownPhotoTargets, photoTargets, selfieOutcome, verdict } from '../src/trust/faceMatch';

describe('video check face match verdict (R-18.15)', () => {
  it('shows nothing without a face in his photos', () => {
    expect(verdict({ photoFaces: 0, frames: [] })).toBeNull();
    expect(verdict(null)).toBeNull();
  });
  it('shows nothing when fewer than 2 frames show a face', () => {
    expect(verdict({ photoFaces: 2, frames: [0.9, -1, -1] })).toBeNull();
  });
  it('matches when 2 of 3 frames pass', () => {
    expect(verdict({ photoFaces: 1, frames: [0.62, 0.2, MATCH_AT] })).toBe('match');
    expect(verdict({ photoFaces: 1, frames: [0.7, -1, 0.55] })).toBe('match');
  });
  it('one matching frame is not enough', () => {
    expect(verdict({ photoFaces: 3, frames: [0.8, 0.31, 0.12] })).toBe('nomatch');
    expect(verdict({ photoFaces: 3, frames: [0.39, 0.39, 0.39] })).toBe('nomatch');
  });
  it('compares against at most 6 https photos, in order', () => {
    const urls = ['https://a/1', null, 'http://x', 'file:///y', ...Array.from({ length: 8 }, (_, i) => `https://a/${i + 2}`)];
    expect(photoTargets(urls)).toEqual(['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5', 'https://a/6']);
  });
});

describe('selfie photo match outcome (R-03.2, #232)', () => {
  const m = (photoFaces: number, frames: number[], photoErrors = 0) => ({ photoFaces, frames, photoErrors });
  it('passes when both stills match his photos', () => {
    expect(selfieOutcome(m(2, [0.55, MATCH_AT]))).toBe('pass');
  });
  it('one matching still is not enough', () => {
    expect(selfieOutcome(m(2, [0.7, 0.3]))).toBe('nomatch');
    expect(selfieOutcome(m(1, [0.1, 0.12]))).toBe('nomatch');
  });
  it('passes without a photo-match claim when no own photo shows a face', () => {
    expect(selfieOutcome(m(0, []))).toBe('pass');
  });
  it('photos that did not load never skip the match', () => {
    expect(selfieOutcome(m(0, [], 2))).toBe('offline');
    expect(selfieOutcome(m(1, [0.6, 0.6], 1))).toBe('pass');
  });
  it('a still without a face asks again', () => {
    expect(selfieOutcome(m(1, [0.6, -1]))).toBe('noface');
    expect(selfieOutcome(m(1, [0.6]))).toBe('noface');
  });
  it('own photos: not rejected, main slot first, https only', () => {
    const p = (slot: number, status: string, url: string | null) => ({ id: String(slot), slot, status, reject_reason: null, url });
    expect(ownPhotoTargets([p(2, 'ok_public', 'https://b'), p(1, 'rejected', 'https://x'), p(0, 'ok_main', 'https://a'), p(3, 'pending', null)])).toEqual(['https://a', 'https://b']);
    expect(ownPhotoTargets(undefined)).toEqual([]);
  });
});

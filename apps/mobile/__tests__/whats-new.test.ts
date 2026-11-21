import { describe, expect, it } from '@jest/globals';
import { pickNote, langOf } from '../src/whatsnew/logic';
import { NOTES, type Note } from '../src/whatsnew/notes';
import { wnDe, wnEn, wnFr } from '../src/i18n/whatsnew';

// F-17 R-17.15 (#238): What's new card rules.
const mk = (id: number): Note => ({ id, date: '2026-11-21', lines: [] });
const three = [mk(3), mk(2), mk(1)];

describe('pickNote', () => {
  it('fresh install: no card', () => {
    expect(pickNote(null, false, three)).toEqual({ note: null, earlier: 0, latest: 3 });
  });
  it('upgrade from a build before the feature: newest note, earlier counted', () => {
    expect(pickNote(null, true, three)).toEqual({ note: three[0], earlier: 2, latest: 3 });
  });
  it('one new note', () => {
    expect(pickNote(2, true, three)).toEqual({ note: three[0], earlier: 0, latest: 3 });
  });
  it('skipped updates: newest only, earlier counted', () => {
    expect(pickNote(1, true, three).earlier).toBe(1);
  });
  it('nothing new (fix-only build)', () => {
    expect(pickNote(3, true, three).note).toBeNull();
  });
  it('no notes at all', () => {
    expect(pickNote(null, true, []).note).toBeNull();
  });
  it('lang falls back to en', () => {
    expect([langOf('fr'), langOf('de'), langOf('it'), langOf(undefined)]).toEqual(['fr', 'de', 'en', 'en']);
  });
});

describe('NOTES content rules', () => {
  it('ids strictly descending and unique, ISO dates', () => {
    NOTES.forEach((n, i) => {
      if (i) expect(n.id).toBeLessThan(NOTES[i - 1].id);
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
  it('2 to 4 lines, short, in en/fr/de', () => {
    for (const n of NOTES) {
      expect(n.lines.length).toBeGreaterThanOrEqual(2);
      expect(n.lines.length).toBeLessThanOrEqual(4);
      for (const l of n.lines)
        for (const lang of ['en', 'fr', 'de'] as const) {
          const [t, s] = l.text[lang];
          expect(t.trim().length).toBeGreaterThan(0);
          expect(s.trim().length).toBeGreaterThan(0);
          expect(t.length).toBeLessThanOrEqual(24);
          expect(s.length).toBeLessThanOrEqual(44);
        }
    }
  });
  it('strings exist in all languages', () => {
    expect(Object.keys(wnFr).sort()).toEqual(Object.keys(wnEn).sort());
    expect(Object.keys(wnDe).sort()).toEqual(Object.keys(wnEn).sort());
  });
});

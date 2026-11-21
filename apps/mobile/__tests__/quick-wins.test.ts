// #219 R-06.8a: quick wins follow the server's completeness weights (Fields.completeness/1).
import { expect, test } from '@jest/globals';
import { quickWins } from '../src/profile/quickWins';
import { nextSection, sectionOf } from '../src/profile/sections';

test('fresh profile: photos, bio and languages first', () => {
  const w = quickWins({}, 1, ['hookup']);
  expect(w.map((x) => [x.id, x.gain])).toEqual([
    ['photos', 10],
    ['bio', 10],
    ['languages', 10],
  ]);
  expect(w[0].count).toBe(4);
  expect(w[0].target).toEqual({ kind: 'photos' });
});

test('no main photo is the first win', () => {
  expect(quickWins({}, 0, ['hookup'])[0]).toMatchObject({ id: 'main_photo', gain: 20 });
});

test('gains shrink as fields fill; targets open the right section', () => {
  const w = quickWins({ bio: 'hi', languages: ['en'], height_cm: 180, position: 'vers' }, 4, ['hookup']);
  expect(w.map((x) => [x.id, x.gain])).toEqual([
    ['body', 5],
    ['hookup', 5],
    ['looking_for', 5],
  ]);
  expect(w[0].target).toEqual({ kind: 'field', section: 'body', key: 'build' });
  expect(w[1].target).toEqual({ kind: 'field', section: 'hookup', key: 'hosting' });
  expect(quickWins({}, 4, ['hookup'], 9).find((x) => x.id === 'photos')).toMatchObject({ gain: 3, count: 1 });
});

test('sport-only profiles get sport wins instead of hookup', () => {
  const ids = quickWins({ bio: 'x', languages: ['en'], height_cm: 1, build: 'slim' }, 5, ['sport']).map((x) => x.id);
  expect(ids).toContain('sport');
  expect(ids).not.toContain('hookup');
});

test('complete profile has no wins', () => {
  const f = { bio: 'x', languages: ['en'], height_cm: 180, build: 'slim', position: 'top', hosting: 'can_host', looking_for: ['dates'], prompt_a: 'y' };
  expect(quickWins(f, 5, ['hookup'])).toEqual([]);
});

test('sections', () => {
  expect(sectionOf('languages')).toBe('basics');
  expect(sectionOf('prompt_q')).toBe('about');
  expect(nextSection('hookup')).toBe('health');
  expect(nextSection('sport')).toBeNull();
});

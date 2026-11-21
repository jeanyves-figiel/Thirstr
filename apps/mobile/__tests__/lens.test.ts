import { describe, expect, it } from '@jest/globals';
import { inLens, lensFields, lensPhoto } from '../src/profile/lens';

// F-06 R-06.1b mirror: Friends/Sport never show hookup or health details or spicy photos.
describe('profile lenses', () => {
  const fields = { bio: 'hi', position: 'top', hiv: 'neg', prep: 'on', sports: ['climbing'], looking_for: ['hookup', 'friends'], tribes: ['jock'], creator: true };

  it('Hookup shows everything', () => {
    expect(lensFields(fields, 'hookup')).toEqual(fields);
  });

  it('Friends drops hookup, health and sport fields and hookup looking-for values', () => {
    expect(lensFields(fields, 'friends')).toEqual({ bio: 'hi', looking_for: ['friends'], tribes: ['jock'] });
  });

  it('Sport adds sport fields', () => {
    expect(lensFields(fields, 'sport')).toEqual({ bio: 'hi', looking_for: ['friends'], tribes: ['jock'], sports: ['climbing'] });
    expect(inLens('position', 'sport')).toBe(false);
  });

  it('drops looking_for when only hookup values remain', () => {
    expect(lensFields({ looking_for: ['now', 'tonight'] }, 'friends')).toEqual({});
  });

  it('only strict-safe photos outside Hookup; main always shows', () => {
    expect(lensPhoto({ slot: 2, main_ok: false }, 'friends')).toBe(false);
    expect(lensPhoto({ slot: 2, main_ok: true }, 'sport')).toBe(true);
    expect(lensPhoto({ slot: 0 }, 'sport')).toBe(true);
    expect(lensPhoto({ slot: 3, main_ok: false }, 'hookup')).toBe(true);
  });
});

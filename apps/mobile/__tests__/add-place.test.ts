// F-12 #191 Add a place (R-12.11): submit rules and en/fr/de strings.
import { describe, expect, test } from '@jest/globals';
import { apDe, apEn, apFr } from '../src/i18n/addplace';
import { canAdd, MAX_ACCURACY_M, PLACE_KINDS } from '../src/scene/addPlace';

const fix = { lat: 47.377, lng: 8.5418, accuracy: 12 };

describe('add a place (R-12.11)', () => {
  test('needs a name, a kind and a precise fix', () => {
    expect(canAdd('Café Hinterhof', 'bar', fix)).toBe(true);
    expect(canAdd(' X ', 'bar', fix)).toBe(false);
    expect(canAdd('Café Hinterhof', null, fix)).toBe(false);
    expect(canAdd('Café Hinterhof', 'home', fix)).toBe(false);
    expect(canAdd('Café Hinterhof', 'bar', null)).toBe(false);
    expect(canAdd('Café Hinterhof', 'bar', { ...fix, accuracy: MAX_ACCURACY_M + 1 })).toBe(false);
  });

  test('kinds match the server and every language names them', () => {
    expect(PLACE_KINDS).toEqual(['club', 'bar', 'sauna', 'gym', 'other']);
    for (const t of [apEn, apFr, apDe]) {
      expect(Object.keys(t).sort()).toEqual(Object.keys(apEn).sort());
      for (const k of PLACE_KINDS) expect(t.kinds[k]).toBeTruthy();
      expect(t.warnBody.length).toBeGreaterThan(60);
    }
  });
});

import { describe, expect, it } from '@jest/globals';
import { modDe, modEn, modFr } from '../src/i18n/mod';

// #111: Hide / Block / Report copy exists in every beta language (D-06).
function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('moderation copy', () => {
  const en = keys(modEn).sort();
  it('fr covers every en key', () => expect(keys(modFr).sort()).toEqual(en));
  it('de covers every en key', () => expect(keys(modDe).sort()).toEqual(en));
  it('block points match in length', () => {
    expect(modFr.blockPoints).toHaveLength(modEn.blockPoints.length);
    expect(modDe.blockPoints).toHaveLength(modEn.blockPoints.length);
  });
});

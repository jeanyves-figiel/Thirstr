import { describe, expect, it } from '@jest/globals';
import { dsaDe, dsaEn, dsaFr } from '../src/i18n/dsa';

// #170: DSA notice / statement-of-reasons / review copy exists in every beta language (D-06).
function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('DSA copy', () => {
  const en = keys(dsaEn).sort();
  it('fr covers every en key', () => expect(keys(dsaFr).sort()).toEqual(en));
  it('de covers every en key', () => expect(keys(dsaDe).sort()).toEqual(en));
});

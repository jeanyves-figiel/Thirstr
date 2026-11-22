import { describe, expect, it } from '@jest/globals';
import { pkxDe, pkxEn, pkxFr } from '../src/i18n/passkeys';

// F-01 R-01.16: passkey copy exists in every beta language (D-06).
function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('Passkeys copy', () => {
  const en = keys(pkxEn).sort();
  it('fr covers every en key', () => expect(keys(pkxFr).sort()).toEqual(en));
  it('de covers every en key', () => expect(keys(pkxDe).sort()).toEqual(en));
});

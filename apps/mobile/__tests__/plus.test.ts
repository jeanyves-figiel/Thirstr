import { describe, expect, it } from '@jest/globals';
import { ApiError } from '../src/api/client';
import { plxDe, plxEn, plxFr } from '../src/i18n/plus';
import { cardHidden, hideCard, isPlus, limits, PLUS_FALLBACK, plusLimitOf, promptsAllowed } from '../src/plus/plus';

// F-23 Thirstr Plus (#7, #318): copy in every beta language, limit errors, no prompts in the first 3 days.
function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('Plus copy', () => {
  const en = keys(plxEn).sort();
  it('fr covers every en key', () => expect(keys(plxFr).sort()).toEqual(en));
  it('de covers every en key', () => expect(keys(plxDe).sort()).toEqual(en));
  it('six benefits in every language', () => [plxEn, plxFr, plxDe].forEach((l) => expect(l.benefits).toHaveLength(6)));
});

describe('Plus helpers', () => {
  it('reads a plus_limit error and ignores others', () => {
    const e = new ApiError(422, 'plus_limit', 'max 1 active plans', undefined, { limit: 'tonight_active', free: 1, plus: 3, next_at: null });
    expect(plusLimitOf(e)).toEqual({ limit: 'tonight_active', free: 1, plus: 3, next_at: null, message: 'max 1 active plans' });
    expect(plusLimitOf(new ApiError(422, 'validation', 'x'))).toBeNull();
    expect(plusLimitOf(new Error('x'))).toBeNull();
  });

  it('old servers without plus/limits behave as Plus (closed beta)', () => {
    expect(isPlus({})).toBe(true);
    expect(limits({})).toEqual(PLUS_FALLBACK);
  });

  it('R-23.7: no prompt for Plus members or in the first 3 days', () => {
    const now = Date.parse('2026-12-10T12:00:00Z');
    expect(promptsAllowed({ plus: { active: true, source: 'beta' } }, now)).toBe(false);
    expect(promptsAllowed({ plus: { active: false, source: 'none' }, created_at: '2026-12-08T12:00:00Z' }, now)).toBe(false);
    expect(promptsAllowed({ plus: { active: false, source: 'none' }, created_at: '2026-12-07T11:00:00Z' }, now)).toBe(true);
  });

  it('a hidden card comes back after 7 days', async () => {
    const t = Date.parse('2026-12-10T12:00:00Z');
    await hideCard('nearby', t);
    expect(await cardHidden('nearby', t + 6 * 86_400_000)).toBe(true);
    expect(await cardHidden('nearby', t + 8 * 86_400_000)).toBe(false);
    expect(await cardHidden('other', t)).toBe(false);
  });
});

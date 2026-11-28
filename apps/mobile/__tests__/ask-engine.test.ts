import { describe, expect, it } from '@jest/globals';
import { parseAsk } from '../src/match/ask';
import { askSmart, instructions, merge, readJson } from '../src/match/engine';
import { _resetRecent, addRecent, clearRecent, loadRecent } from '../src/match/recent';

const known = { tribes: ['bear', 'jock'], interests: ['hiking', 'cinema'], position: ['top', 'bottom', 'vers'] };

describe('Ask engines (#346)', () => {
  it('reads JSON out of a fenced model answer', () => {
    expect(readJson('```json\n{"filters":{"age_min":30},"intents":["sport"]}\n```')).toEqual({ filters: { age_min: 30 }, intents: ['sport'] });
    expect(readJson('no json here')).toBeNull();
    expect(readJson('{bad')).toBeNull();
  });

  it('model fills gaps, grammar wins, schema enforced', () => {
    const g = parseAsk('bears', known);
    const r = merge(g, { filters: { tribes: ['jock', 'unicorn'], interests: ['hiking'], hiv: ['negative'] } as never, intents: ['hookup', 'evil' as never] }, known);
    expect(new Set(r.filters.tribes as string[])).toEqual(new Set(['bear', 'jock']));
    expect(r.filters.interests).toEqual(['hiking']);
    expect(r.filters).not.toHaveProperty('hiv');
    expect(r.refused).toContain('health');
    expect(r.intents).toEqual(['hookup']);
  });

  it('refused asks never reach a model; no native module → grammar', async () => {
    const r = await askSmart('no fems, hiv negative', known);
    expect(r.refused.length).toBeGreaterThan(0);
    const b = await askSmart('bears', known);
    expect(b.filters.tribes).toEqual(['bear']);
  });

  it('instructions list only allowed values and no forbidden fields', () => {
    const s = instructions(known);
    expect(s).toContain('tribes: bear, jock');
    expect(s).not.toMatch(/ethnicity:|hiv:/);
  });

  it('recent asks: newest first, deduped, max 20, clearable', async () => {
    _resetRecent();
    await clearRecent();
    for (let i = 0; i < 25; i++) addRecent(`ask ${i}`);
    await addRecent('ASK 3');
    const r = await loadRecent();
    expect(r[0]).toBe('ASK 3');
    expect(r).toHaveLength(20);
    expect(r.filter((x) => x.toLowerCase() === 'ask 3')).toHaveLength(1);
    await clearRecent();
    expect(await loadRecent()).toEqual([]);
  });
});

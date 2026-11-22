import { describe, expect, it, jest } from '@jest/globals';
import { ARTICLES, CATS, META, type Block } from '../src/help/articles';
import { hxDe, hxEn, hxFr } from '../src/i18n/help';

// F-22 (#178): every help article in en / fr / de, known routes only, ≤ 600 words; help copy complete.
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const ROUTES = new Set(['PrivacySettings', 'ChatSettings', 'DataSaverSettings', 'ChatBackupSettings', 'Trips', 'Blocked', 'CheckinStart', 'SafetySettings', 'AppLock', 'AccountSettings', 'Recovery', 'Devices', 'Verify', 'RecoveryClaim', 'Tabs', 'Help', 'HelpContact']);
const words = (b: Block[]) =>
  b
    .map((x) => ('p' in x ? x.p : 'h' in x ? x.h : 'ol' in x ? x.ol.join(' ') : 'ul' in x ? x.ul.join(' ') : x.go))
    .join(' ')
    .split(/\s+/).length;

function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('help articles', () => {
  const ids = META.map((m) => m.id);
  it('ids are unique and every category has articles', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CATS) expect(META.some((m) => m.cat === c.id)).toBe(true);
  });
  it.each(['en', 'fr', 'de'] as const)('%s has every article, short, with known routes', (l) => {
    expect(Object.keys(ARTICLES[l]).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const a = ARTICLES[l][id];
      expect(a.title.length).toBeGreaterThan(3);
      expect(words(a.body)).toBeLessThanOrEqual(600);
      for (const b of a.body) if ('go' in b) expect(ROUTES.has(b.route)).toBe(true);
    }
  });
  it('related ids exist', () => {
    for (const m of META) for (const r of m.related) expect(ids).toContain(r);
  });
  it('fr and de have the same go buttons as en', () => {
    for (const id of ids) {
      const go = (l: 'en' | 'fr' | 'de') => ARTICLES[l][id].body.filter((b) => 'go' in b).map((b) => ('go' in b ? b.route : ''));
      expect(go('fr')).toEqual(go('en'));
      expect(go('de')).toEqual(go('en'));
    }
  });
});

describe('help copy', () => {
  const en = keys(hxEn).sort();
  it('fr covers every en key', () => expect(keys(hxFr).sort()).toEqual(en));
  it('de covers every en key', () => expect(keys(hxDe).sort()).toEqual(en));
  it('ladder and hold lists match', () => {
    expect(hxFr.ends).toHaveLength(hxEn.ends.length);
    expect(hxDe.ends).toHaveLength(hxEn.ends.length);
  });
});

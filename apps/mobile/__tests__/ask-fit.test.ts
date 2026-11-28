import { describe, expect, test } from '@jest/globals';
import { choose, emptyState, featuresOf, FEATURES, learn, learnedTraits, markPicked, N, notForMe, windowOf } from '../src/match/picks';
import { parseAsk, sanitize } from '../src/match/ask';
import { bestFitOrder, fitOf, hostingWorks, positionsWork } from '../src/match/fit';

// F-24 Ask & Fit (#338, D-27): the phrase grammar (R-24.3 engine 3), refusals (R-24.5, AC-24.2)
// and the on-device Fit rules (R-24.12).

describe('Ask grammar (en / fr / de)', () => {
  test('the mockup ask becomes filters', () => {
    const r = parseAsk('verified vers guys under 35 who can host tonight, into techno');
    expect(r.filters).toEqual({
      verified_only: true,
      position: ['vers'],
      age_max: 34,
      hosting: ['can_host'],
      looking_for: ['tonight'],
      interests: ['techno'],
    });
    expect(r.refused).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  test('ages, ranges, decades, distance', () => {
    expect(parseAsk('25-35').filters).toMatchObject({ age_min: 25, age_max: 35 });
    expect(parseAsk('entre 30 et 40 ans').filters).toMatchObject({ age_min: 30, age_max: 40 });
    expect(parseAsk('in their 40s').filters).toMatchObject({ age_min: 40, age_max: 49 });
    expect(parseAsk('über 30').filters).toMatchObject({ age_min: 31 });
    expect(parseAsk('30+').filters).toMatchObject({ age_min: 30 });
    expect(parseAsk('within 3 km').filters).toEqual({ distance_max: 3000 });
    expect(parseAsk('under 10 km').filters).toEqual({ distance_max: 10000 });
    expect(parseAsk('im Umkreis von 5 km').filters).toEqual({ distance_max: 5000 });
    expect(parseAsk('bears near me').filters).toEqual({ tribes: ['bear'], distance_max: 2000 });
  });

  test('positions, compound first; French and German', () => {
    expect(parseAsk('vers top').filters.position).toEqual(['vers_top']);
    expect(parseAsk('actif qui reçoit ce soir').filters).toEqual({ position: ['top'], hosting: ['can_host'], looking_for: ['tonight'] });
    expect(parseAsk('passiv, kann empfangen, jetzt').filters).toEqual({ position: ['bottom'], hosting: ['can_host'], looking_for: ['now'], has_now: true });
    expect(parseAsk('Bären mit Leder').filters.tribes).toEqual(['bear', 'leather']);
  });

  test('sport asks pick the Sport chip', () => {
    const r = parseAsk('gym buddy mornings');
    expect(r.filters).toEqual({ sports: ['gym'], schedule: ['mornings'] });
    expect(r.intents).toEqual(['sport']);
    expect(parseAsk('partenaire d’escalade le soir').filters).toMatchObject({ sports: ['climbing'], schedule: ['evenings'] });
    // "ce soir" is tonight, not evenings
    expect(parseAsk('ce soir').filters).toEqual({ looking_for: ['tonight'] });
  });

  test('interests in every language, longest phrase first', () => {
    expect([...((parseAsk('craft beer and board games').filters.interests as string[]) ?? [])].sort()).toEqual(['board_games', 'craft_beer']);
    expect(parseAsk('aime la cuisine et les chiens').filters.interests).toEqual(['cooking', 'dogs']);
    expect(parseAsk('Kochen, Hunde').filters.interests).toEqual(['cooking', 'dogs']);
    // "chat" is talking, never cats
    expect(parseAsk('just chat').filters).toEqual({ looking_for: ['chat'] });
    expect(parseAsk('clean cut').filters).toEqual({ tribes: ['clean_cut'] });
  });

  test('refuses HIV status, ethnicity, exclusions and languages (AC-24.2)', () => {
    const r = parseAsk('neg white guys only, no fems');
    expect(r.refused.sort()).toEqual(['ethnicity', 'exclusion', 'health']);
    expect(r.filters).toEqual({});
    expect(parseAsk('clean guys on prep').refused).toEqual(['health']);
    expect(parseAsk('pas de folles').refused).toEqual(['exclusion']);
    expect(parseAsk('keine Tunten').refused).toEqual(['exclusion']);
    expect(parseAsk('who speaks french').refused).toEqual(['language']);
    expect(parseAsk('asiatiques').refused).toEqual(['ethnicity']);
  });

  test('unknown words are listed, nothing invented', () => {
    const r = parseAsk('tall guys with tattoos');
    expect(r.filters).toEqual({});
    expect(r.ignored).toEqual(['tall', 'tattoos']);
  });

  test('sanitize keeps only the filter schema (engine output)', () => {
    const r = sanitize(
      {
        filters: { hiv: ['neg'], languages: ['fr'], age_min: 12, age_max: 140, position: ['top', 'evil'], distance_max: 5, online_now: 'yes' as unknown as boolean, foo: 1 },
        intents: ['hookup', 'x' as never],
        refused: [],
        ignored: [],
      },
      { position: ['top', 'bottom'] },
    );
    expect(r.filters).toEqual({ age_min: 18, age_max: 99, position: ['top'], distance_max: 100 });
    expect(r.refused.sort()).toEqual(['health', 'language']);
    expect(r.intents).toEqual(['hookup']);
  });
});

describe('Fit rules (R-24.12)', () => {
  test('positions and hosting that work together', () => {
    expect(positionsWork('top', 'vers_bottom')).toBe(true);
    expect(positionsWork('top', 'top')).toBe(false);
    expect(positionsWork('vers', 'bottom')).toBe(true);
    expect(positionsWork('side', 'side')).toBe(true);
    expect(positionsWork('side', 'vers')).toBe(false);
    expect(positionsWork(null, 'top')).toBe(false);
    expect(hostingWorks('can_travel', 'can_host')).toBe(true);
    expect(hostingWorks('either', 'either')).toBe(true);
    expect(hostingWorks('can_host', 'can_host')).toBe(false);
    expect(hostingWorks('neither', 'can_host')).toBe(false);
  });

  const me = { position: 'top', hosting: 'can_travel', looking_for: ['tonight'], interests: ['techno', 'hiking', 'cooking', 'opera'], sports: ['climbing'], schedule: ['evenings'], limits: ['fisting'] };
  const luca = { position: 'vers_bottom', hosting: 'can_host', looking_for: ['tonight', 'dates'], interests: ['techno', 'hiking', 'cooking', 'dogs'], sports: ['climbing'], schedule: ['evenings'], practices: ['kissing'] };

  test('the mockup: Fit with reasons', () => {
    const r = fitOf(me, luca, 'hookup');
    expect(r.fit).toBe(true);
    expect(r.common).toBe(4);
    expect(r.reasons.map((x) => x.kind)).toEqual(['position', 'hosting', 'when', 'interests', 'sports', 'no_clash']);
  });

  test('a hard-no clash is never Fit', () => {
    const r = fitOf(me, { ...luca, practices: ['fisting'] }, 'hookup');
    expect(r.clash).toBe(true);
    expect(r.fit).toBe(false);
    expect(r.reasons.find((x) => x.kind === 'no_clash')).toBeUndefined();
  });

  test('Friends lens: no hookup lines, no sports; Sport lens: no tribes', () => {
    const f = fitOf(me, luca, 'friends');
    expect(f.fit).toBe(false);
    expect(f.reasons.map((x) => x.kind)).toEqual(['interests']);
    const s = fitOf({ ...me, tribes: ['bear'] }, { ...luca, tribes: ['bear'] }, 'sport');
    expect(s.shared.tribes).toEqual([]);
    expect(s.shared.sports).toEqual(['climbing']);
  });

  test('missing data scores zero; Best fit keeps nearest first on ties', () => {
    expect(fitOf(me, null, 'hookup').score).toBe(0);
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const s: Record<string, number> = { a: 0, b: 3, c: 0 };
    expect(bestFitOrder(items, (x) => s[x.id]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('Picks ranker (R-24.20–R-24.24)', () => {
  const self = { interests: ['techno'], position: 'top', hosting: 'can_travel', looking_for: ['tonight'] };
  const bear = (id: string, age: number, extra = {}) => ({ id, age, verified: true, intents: ['hookup' as const], distance: { kind: 'area' as const, bucket: '500_1k', m: 600 }, match: { tribes: ['bear'], ...extra } });
  const twink = (id: string, age: number) => ({ id, age, verified: true, intents: ['hookup' as const], distance: { kind: 'area' as const, bucket: '1_2k', m: 1500 }, match: { tribes: ['twink'] } });

  test('features are one fixed-size vector', () => {
    expect(FEATURES.length).toBe(N);
    expect(N).toBeLessThanOrEqual(40);
  });

  test('windows at 07:00 and 19:00 local', () => {
    expect(windowOf(new Date(2026, 10, 28, 6, 0)).key).toBe('2026-11-27T19');
    expect(windowOf(new Date(2026, 10, 28, 7, 0)).key).toBe('2026-11-28T07');
    expect(windowOf(new Date(2026, 10, 28, 21, 0)).key).toBe('2026-11-28T19');
    expect(windowOf(new Date(2026, 10, 28, 21, 0)).next.getHours()).toBe(7);
  });

  test('learns from replies and explains what it learned', () => {
    let st = emptyState();
    for (let i = 0; i < 6; i++) {
      const b = bear('b' + i, 38);
      st = { ...st, model: learn(st.model, featuresOf(b, { common: 0, shared: { interests: [], sports: [], tribes: [] }, fit: false, clash: false, reasons: [], score: 0 }), 'reply') };
      const t = twink('t' + i, 22);
      st = { ...st, model: learn(st.model, featuresOf(t, { common: 0, shared: { interests: [], sports: [], tribes: [] }, fit: false, clash: false, reasons: [], score: 0 }), 'less') };
    }
    const traits = learnedTraits(st.model);
    expect(traits).toEqual(expect.arrayContaining([{ kind: 'tribe', v: 'bear' }, { kind: 'age', band: 3 }]));
    const picks = choose(st, [twink('x', 23), bear('y', 37)], self, 1, () => false);
    expect(picks[0].person.id).toBe('y');
    expect(picks[0].learned).toEqual(expect.arrayContaining([{ kind: 'tribe', v: 'bear' }]));
  });

  test('never picks: no Fit inputs, chats, cooldown, hard-no clash', () => {
    let st = emptyState();
    const people = [
      { ...bear('nomatch', 30), match: null },
      bear('chatting', 30),
      bear('clash', 30, { practices: ['fisting'] }),
      bear('ok', 30),
    ];
    const me = { ...self, limits: ['fisting'] };
    expect(choose(st, people, me, 5, (id) => id === 'chatting').map((p) => p.person.id)).toEqual(['ok']);
    st = markPicked(st, ['ok'], 'w', 1000);
    expect(choose(st, people, me, 5, () => false, 2000).map((p) => p.person.id)).toEqual(['chatting']);
    st = notForMe(st, 'chatting', 2000);
    expect(choose(st, people, me, 5, () => false, 3000)).toEqual([]);
    expect(choose(st, people, me, 5, () => false, 2000 + 31 * 86_400_000).length).toBe(2);
  });
});

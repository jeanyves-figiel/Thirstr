// F-04 #113: one merged map with intent chips (R-04.18), intent rings (R-04.19), place layers (R-04.20).
import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../src/api/client', () => ({ api: jest.fn(), API_BASE: 'http://x' }));

import type { Card, Place } from '../src/api/types';
import { filterMode, query } from '../src/explore/explore';
import { activeKinds, defaultLayers, fitCamera, pinLabel, placeKind, restoreIntents, restoreLayers, ringSegments, toggleIntent, toggleLayer } from '../src/explore/mapShared';
import { modeColor } from '../src/theme/tokens';

describe('intent chips (R-04.18)', () => {
  test('toggle keeps order and never empties', () => {
    expect(toggleIntent(['hookup', 'friends', 'sport'], 'friends')).toEqual(['hookup', 'sport']);
    expect(toggleIntent(['sport'], 'hookup')).toEqual(['hookup', 'sport']);
    expect(toggleIntent(['sport'], 'sport')).toEqual(['sport']);
  });

  test('saved chips restore safely, default all three', () => {
    expect(restoreIntents(null)).toEqual(['hookup', 'friends', 'sport']);
    expect(restoreIntents('["sport","hookup"]')).toEqual(['hookup', 'sport']);
    expect(restoreIntents('[]')).toEqual(['hookup', 'friends', 'sport']);
    expect(restoreIntents('{oops')).toEqual(['hookup', 'friends', 'sport']);
  });

  test('requests carry intents and the first chip as mode', () => {
    expect(query(['friends', 'sport'], { verified_only: true } as never)).toBe('mode=friends&intents=friends,sport&verified_only=true');
  });

  test('filters panel: a single chip shows its groups, several the shared ones', () => {
    expect(filterMode(['hookup'])).toBe('hookup');
    expect(filterMode(['sport'])).toBe('sport');
    expect(filterMode(['hookup', 'sport'])).toBe('friends');
  });
});

describe('intent ring (R-04.19, AC-04.11)', () => {
  const circ = 2 * Math.PI * 23;

  test('one intent = full ring in its colour', () => {
    const [s] = ringSegments(['sport'], 23);
    expect(s.color).toBe(modeColor.sport);
    expect(s.offset).toBe(0);
    expect(ringSegments(['sport'], 23)).toHaveLength(1);
  });

  test('two intents = two equal segments, hookup → friends → sport, 5 px gaps', () => {
    const segs = ringSegments(['sport', 'friends'], 23);
    expect(segs.map((s) => s.color)).toEqual([modeColor.friends, modeColor.sport]);
    const len = parseFloat(segs[0].dash.split(' ')[0]);
    expect(len).toBeCloseTo(circ / 2 - 5, 1);
    expect(segs[1].offset).toBeCloseTo(-(circ / 2 + 2.5), 5);
  });

  test('three intents = thirds', () => {
    const segs = ringSegments(['hookup', 'friends', 'sport'], 23);
    expect(segs).toHaveLength(3);
    expect(parseFloat(segs[2].dash)).toBeCloseTo(circ / 3 - 5, 1);
  });

  test('screen-reader label names every intent', () => {
    const c = { display_name: 'Sam', age: 31, intents: ['hookup', 'friends'] } as unknown as Card;
    const label = pinLabel(c, { hookup: 'Hookup', friends: 'Friends', sport: 'Sport' }, 'and', '400 m', (w, l, d) => `${w}, looking for ${l}, ${d}`);
    expect(label).toBe('Sam, 31, looking for Hookup and Friends, 400 m');
  });
});

describe('place layers (R-04.20)', () => {
  test('defaults (#223): parties only; gyms by themselves in Sport-only', () => {
    expect(activeKinds(defaultLayers, ['hookup', 'friends', 'sport'])).toEqual(['parties']);
    expect(activeKinds(defaultLayers, ['sport'])).toEqual(['parties', 'gyms']);
  });

  test('toggling gyms once stops the automatic rule', () => {
    const off = toggleLayer(defaultLayers, 'gyms', ['sport']);
    expect(off.gymsTouched).toBe(true);
    expect(activeKinds(off, ['sport'])).not.toContain('gyms');
    const on = toggleLayer(off, 'gyms', ['hookup']);
    expect(activeKinds(on, ['hookup'])).toContain('gyms');
  });

  test('saved layers restore over defaults', () => {
    expect(restoreLayers('{"on":{"saunas":true}}').on).toEqual({ clubs: false, saunas: true, parties: true, gyms: false });
    expect(restoreLayers('nope')).toEqual(defaultLayers);
  });

  test('places map to their chip', () => {
    const p = (type: Place['type'], kind: Place['kind']) => ({ type, kind }) as Place;
    expect(placeKind(p('venue', 'bar'))).toBe('clubs');
    expect(placeKind(p('venue', 'club'))).toBe('clubs');
    expect(placeKind(p('venue', 'sauna'))).toBe('saunas');
    expect(placeKind(p('venue', 'gym'))).toBe('gyms');
    expect(placeKind(p('event', 'official'))).toBe('parties');
    expect(placeKind(p('party', 'hosted'))).toBe('parties');
  });
});

describe('full-bleed camera (#113)', () => {
  test('centres the point between the floating header and the sheet', () => {
    const p = { lat: 47.37, lng: 8.54 };
    const noHeader = fitCamera(p, 1000, 390, 800, 300);
    const withHeader = fitCamera(p, 1000, 390, 800, 300, 140);
    // Header pushes the visible middle down → camera moves less south than without it.
    expect(withHeader.lat).toBeGreaterThan(noHeader.lat);
  });
});

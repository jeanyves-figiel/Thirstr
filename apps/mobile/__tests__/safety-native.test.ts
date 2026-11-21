import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/chat/kv', () => ({
  kv: { get: async () => null, set: async () => {}, del: async () => {}, keys: async () => [], wipe: async () => {} },
}));
jest.mock('../src/explore/location', () => ({ currentPosition: async () => null }));
jest.mock('../src/api/client', () => ({ api: async () => ({}) }));

import { livePayload, parseSafetyLink, routeFor, shortcutsFor } from '../src/safety/native';
import { dxEn } from '../src/i18n/date';
import type { Active } from '../src/safety/safety';

const now = Date.parse('2026-11-22T21:00:00Z');
const a = (over: Partial<Active> = {}): Active => ({
  token: 't',
  due: new Date(now + 90 * 60_000).toISOString(),
  started: new Date(now - 30 * 60_000).toISOString(),
  ext: 0,
  name: 'Me',
  live: false,
  peer: 'Léa',
  cid: 'c1',
  who: { name: 'Léa', age: 29 },
  ...over,
});

describe('#119 R-13.20 Live Activity + quick actions', () => {
  it('keeps the two SafetyAttributes.swift copies identical (ActivityKit matches by type)', () => {
    // Jest runs from apps/mobile (no Node typings in this project, hence require).
    const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
    const app = fs.readFileSync('modules/thirstr-safety/ios/SafetyAttributes.swift', 'utf8');
    const ext = fs.readFileSync('targets/safety-live/SafetyAttributes.swift', 'utf8');
    expect(app).toContain('struct SafetyAttributes');
    expect(app).toBe(ext);
  });

  it('parses only thirstr://safety/* links', () => {
    expect(parseSafetyLink('thirstr://safety/ok')).toBe('ok');
    expect(parseSafetyLink('thirstr://safety/more/')).toBe('more');
    expect(parseSafetyLink('thirstr://safety/quick?x=1')).toBe('quick');
    expect(parseSafetyLink('thirstr://safety/wipe')).toBeNull();
    expect(parseSafetyLink('thirstr://p/abcdefghij')).toBeNull();
    expect(parseSafetyLink('https://evil.example/safety/ok')).toBeNull();
    expect(parseSafetyLink(null)).toBeNull();
  });

  it('routes like the live bar and the notification actions', () => {
    expect(routeFor('start', null)).toEqual({ screen: 'CheckinStart', params: {} });
    expect(routeFor('sos', null)).toEqual({ screen: 'Safety' });
    expect(routeFor('ok', null)).toEqual({ screen: 'Safety' });
    expect(routeFor('start', a(), now)).toEqual({ screen: 'SafetyQuick' });
    expect(routeFor('sos', a(), now)).toEqual({ screen: 'SafetyQuick' });
    // I'm OK always passes the due screen (PIN / Face ID, duress PIN).
    expect(routeFor('ok', a(), now)).toEqual({ screen: 'CheckinDue' });
    expect(routeFor('more', a(), now)).toEqual({ screen: 'SafetyQuick', extend: true });
    expect(routeFor('more', a({ ext: 3 }), now)).toEqual({ screen: 'SafetyQuick' });
    // Past due: due screen, except +30 min.
    const late = a({ due: new Date(now - 60_000).toISOString() });
    expect(routeFor('quick', late, now)).toEqual({ screen: 'CheckinDue' });
    expect(routeFor('sos', late, now)).toEqual({ screen: 'CheckinDue' });
    expect(routeFor('more', late, now)).toEqual({ screen: 'SafetyQuick', extend: true });
  });

  it('puts no names on the lock screen', () => {
    const p = livePayload(a(), 2);
    expect(p.due).toBe(now + 90 * 60_000);
    expect(p.started).toBe(now - 30 * 60_000);
    expect(p.title).toBe(dxEn.laTitle);
    expect(p.sub).toMatch(/2 contacts in the loop$/);
    expect(p.canExtend).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/Léa|Thirstr|Me\b/);
    expect(livePayload(a(), 1).sub).toMatch(/1 contact in the loop$/);
    expect(livePayload(a(), 0).sub).not.toMatch(/contact/);
    expect(livePayload(a({ ext: 3 }), 1).canExtend).toBe(false);
  });

  it('never starts the bar before it ends', () => {
    const p = livePayload(a({ started: new Date(now + 200 * 60_000).toISOString() }), 1);
    expect(p.started).toBeLessThanOrEqual(p.due);
  });

  it('quick actions follow the check-in', () => {
    expect(shortcutsFor(null).map((s) => s.type)).toEqual(['start', 'sos']);
    expect(shortcutsFor(a()).map((s) => s.type)).toEqual(['ok', 'more', 'sos']);
    expect(shortcutsFor(a({ ext: 3 })).map((s) => s.type)).toEqual(['ok', 'sos']);
    for (const s of [...shortcutsFor(null), ...shortcutsFor(a())]) {
      expect(s.title).toBeTruthy();
      expect(s.symbol).toMatch(/^[a-z.]+$/);
      expect(JSON.stringify(s)).not.toMatch(/Léa/);
    }
  });
});

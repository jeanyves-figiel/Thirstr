// #247 friend perks: pure rules for "Show me to friends" (R-07.47) and online alerts (R-07.48).
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/api/client', () => ({ api: jest.fn() }));
import { accept, due, EVERY_MS, metres, MOVE_M, round, STALE_MS, visible } from '../src/chat/friendLoc';
import { QUIET_MS, shouldTell } from '../src/chat/friendOnline';

const zurich = { lat: 47.3769, lng: 8.5417 };
const now = 1_800_000_000_000;

describe('friend location', () => {
  it('rounds to about 100 m', () => {
    expect(round(47.37694)).toBe(47.377);
    expect(metres({ lat: 47.3769, lng: 8.5417 }, { lat: round(47.3769), lng: round(8.5417) })).toBeLessThan(120);
  });

  it('sends at start, every 10 min, and after 200 m', () => {
    const until = now + 3600_000;
    expect(due(null, zurich, now)).toBe(false);
    expect(due({ until: now - 1 }, zurich, now)).toBe(false);
    expect(due({ until }, null, now)).toBe(false);
    expect(due({ until }, zurich, now)).toBe(true);
    const sent = { ...zurich, at: now };
    expect(due({ until, sent }, zurich, now + 60_000)).toBe(false);
    expect(due({ until, sent }, zurich, now + EVERY_MS)).toBe(true);
    const far = { lat: zurich.lat + (MOVE_M + 20) / 111_320, lng: zurich.lng };
    expect(due({ until, sent }, far, now + 60_000)).toBe(true);
  });

  it('accepts only sane, future spots and caps at 24 h', () => {
    expect(accept({ t: 'friend.loc', stop: true }, now)).toBeNull();
    expect(accept({ t: 'friend.loc', lat: 95, lng: 8, until: now + 1 }, now)).toBeNull();
    expect(accept({ t: 'friend.loc', lat: 47, lng: 8, until: now - 1 }, now)).toBeNull();
    const s = accept({ t: 'friend.loc', lat: 47.12345, lng: 8.98765, until: now + 99 * 3600_000 }, now)!;
    expect(s).toEqual({ lat: 47.123, lng: 8.988, until: now + 24 * 3600_000, at: now });
  });

  it('hides expired or stale spots', () => {
    const s = { lat: 1, lng: 1, until: now + 3600_000, at: now };
    expect(visible(s, now + 60_000)).toBe(true);
    expect(visible(s, now + STALE_MS)).toBe(false);
    expect(visible({ ...s, until: now }, now + 1)).toBe(false);
    expect(visible(null, now)).toBe(false);
  });
});

describe('friend online alert', () => {
  it('tells only on offline → online, at most once per 2 h', () => {
    expect(shouldTell({}, true, now)).toBe(false);
    expect(shouldTell({ online: true }, true, now)).toBe(false);
    expect(shouldTell({ online: false }, false, now)).toBe(false);
    expect(shouldTell({ online: false }, true, now)).toBe(true);
    expect(shouldTell({ online: false, told: now - 60_000 }, true, now)).toBe(false);
    expect(shouldTell({ online: false, told: now - QUIET_MS }, true, now)).toBe(true);
  });
});

import { describe, expect, it } from '@jest/globals';
import { passes } from '../src/trust/liveness';

// #131: thresholds for the on-device selfie check (numbers only, no images).
const base = { faces: 1, yaw: 0.02, pitch: 0.01, leftEye: 0.3, rightEye: 0.3, mouth: 0.5, noseX: 0, noseY: 0.6 };

describe('liveness steps', () => {
  it('turn passes on a ~16° yaw change either way', () => {
    expect(passes('turn_left', base, { ...base, yaw: 0.3 })).toBe(true);
    expect(passes('turn_right', base, { ...base, yaw: -0.26 })).toBe(true);
    expect(passes('turn_left', base, { ...base, yaw: 0.1 })).toBe(false);
  });
  it('turn falls back to the nose offset when yaw reads flat', () => {
    expect(passes('turn_left', base, { ...base, yaw: 0, noseX: 0.15 })).toBe(true);
  });
  it('look up uses pitch or the nose fallback', () => {
    expect(passes('look_up', base, { ...base, pitch: 0.2 })).toBe(true);
    expect(passes('look_up', base, { ...base, pitch: 0.01, noseY: 0.72 })).toBe(true);
    expect(passes('look_up', base, { ...base })).toBe(false);
  });
  it('smile needs the mouth 8 % wider', () => {
    expect(passes('smile', base, { ...base, mouth: 0.55 })).toBe(true);
    expect(passes('smile', base, { ...base, mouth: 0.52 })).toBe(false);
  });
  it('no face never passes', () => {
    expect(passes('turn_left', base, { faces: 0 })).toBe(false);
  });
});

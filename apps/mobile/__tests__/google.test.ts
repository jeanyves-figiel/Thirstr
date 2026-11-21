import { describe, expect, it } from '@jest/globals';
import { GOOGLE_IOS_CLIENT_ID, reversedClientId } from '../src/auth/google';

describe('Google iOS client (#25 I-03)', () => {
  it('redirects through the reversed client ID that app.config.js registers', () => {
    expect(reversedClientId('123-abc.apps.googleusercontent.com')).toBe('com.googleusercontent.apps.123-abc');
    const cfg = require('../app.config.js')({ config: { ios: { infoPlist: { A: 1 } } } });
    expect(cfg.ios.infoPlist.A).toBe(1);
    expect(cfg.ios.infoPlist.CFBundleURLTypes[0].CFBundleURLSchemes).toEqual([reversedClientId(GOOGLE_IOS_CLIENT_ID)]);
  });
});

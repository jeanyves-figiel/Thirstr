import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/api/client', () => ({ api: jest.fn(), ApiError: class extends Error {} }));
jest.mock('../src/auth/passkey', () => ({ addPasskey: jest.fn(), passkeysAvailable: () => true }));
jest.mock('../src/app/session', () => ({ useSession: jest.fn() }));
jest.mock('../src/safety/lock', () => ({ deviceAuth: jest.fn() }));

// F-01 R-01.16: "Signed in with" and the remove dialog's other way back in.
import { firstMethod, otherWay } from '../src/me/PasskeysScreen';

describe('passkey sign-in methods', () => {
  it('names the OIDC provider when known', () => {
    expect(firstMethod({ has_oidc: true, oidc_provider: 'apple' })).toBe('Apple');
    expect(firstMethod({ has_oidc: true, oidc_provider: 'google' })).toBe('Google');
    expect(firstMethod({ has_oidc: true, oidc_provider: null })).toBe('Apple or Google');
  });
  it('falls back to email, then passkey', () => {
    expect(firstMethod({ has_email: true })).toBe('Email');
    expect(firstMethod({})).toBe('Passkey');
    expect(otherWay({})).toBeNull();
  });
});
